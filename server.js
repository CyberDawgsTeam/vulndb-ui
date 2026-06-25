const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const multer = require('multer');
const Minio = require('minio');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const { Client } = require('ssh2');
const net = require('net');

let pool;
let minioClient;
const upload = multer({ dest: os.tmpdir() });

const setupDatabase = () => {
    return new Promise((resolve, reject) => {
        const sshClient = new Client();
        
        // Start a local server to pipe to the SSH tunnel
        const server = net.createServer(socket => {
            sshClient.forwardOut(
                socket.remoteAddress,
                socket.remotePort,
                process.env.DB_HOST || '127.0.0.1',
                process.env.DB_PORT || 3306,
                (err, stream) => {
                    if (err) {
                        console.error('SSH forwardOut error:', err);
                        socket.end();
                        return;
                    }
                    socket.pipe(stream).pipe(socket);
                }
            );
        });

        sshClient.on('ready', () => {
            console.log('SSH tunnel established');
            
            // Listen on a random free port for the local port forwarder
            server.listen(0, '127.0.0.1', () => {
                const localPort = server.address().port;
                console.log(`Local port forwarder listening on port ${localPort}`);
                
                // Initialize the MySQL pool to connect to the local port forwarder
                pool = mysql.createPool({
                    host: '127.0.0.1',
                    port: localPort,
                    user: process.env.DB_USER,
                    password: process.env.DB_PASSWORD,
                    database: process.env.DB_NAME,
                    waitForConnections: true,
                    connectionLimit: 10,
                    queueLimit: 0
                });
                
                resolve();
            });
        }).on('error', err => {
            console.error('SSH connection error:', err);
            reject(err);
        });

        // Connect SSH using credentials from .env
        sshClient.connect({
            host: process.env.SSH_HOST,
            port: process.env.SSH_PORT || 22,
            username: process.env.SSH_USER,
            password: process.env.SSH_PASSWORD
        });
    });
};

const setupMinio = async () => {
    const url = new URL(process.env.MINIO_URL);
    minioClient = new Minio.Client({
        endPoint: url.hostname,
        port: Number(url.port) || (url.protocol === 'https:' ? 443 : 80),
        useSSL: url.protocol === 'https:',
        accessKey: process.env.MINIO_ACCESS_KEY,
        secretKey: process.env.MINIO_SECRET_KEY
    });

    const bucket = process.env.MINIO_BUCKET;
    if (!(await minioClient.bucketExists(bucket))) {
        await minioClient.makeBucket(bucket);
        console.log(`Created MinIO bucket "${bucket}"`);
    }
};

function parseDependsOn(row) {
    if (row.depends_on == null) return { ...row, depends_on: [] };
    if (typeof row.depends_on === 'string') {
        return { ...row, depends_on: JSON.parse(row.depends_on) };
    }
    return row;
}

// GET all configurations
app.get('/api/configurations', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM configurations');
        const [attachments] = await pool.query(
            'SELECT id, configuration_id, original_name, mime_type, size_bytes, uploaded_at FROM attachments'
        );

        const attachmentsByConfig = new Map();
        for (const attachment of attachments) {
            const list = attachmentsByConfig.get(attachment.configuration_id) || [];
            list.push(attachment);
            attachmentsByConfig.set(attachment.configuration_id, list);
        }

        res.json(rows.map(parseDependsOn).map(row => ({
            ...row,
            attachments: attachmentsByConfig.get(row.id) || []
        })));
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// POST a new configuration
app.post('/api/configurations', async (req, res) => {
    const { name, platform, category, type, script, run_as, depends_on } = req.body;
    try {
        const [result] = await pool.query(
            'INSERT INTO configurations (name, platform, category, type, script, run_as, depends_on) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [name, platform, category, type, script, run_as, JSON.stringify(depends_on || [])]
        );
        res.status(201).json({ id: result.insertId, name, platform, category, type, script, run_as, depends_on: depends_on || [] });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// PUT update a configuration
app.put('/api/configurations/:id', async (req, res) => {
    const { name, platform, category, type, script, run_as, depends_on } = req.body;
    try {
        await pool.query(
            'UPDATE configurations SET name = ?, platform = ?, category = ?, type = ?, script = ?, run_as = ?, depends_on = ? WHERE id = ?',
            [name, platform, category, type, script, run_as, JSON.stringify(depends_on || []), req.params.id]
        );
        res.json({ id: req.params.id, name, platform, category, type, script, run_as, depends_on: depends_on || [] });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// DELETE a configuration — blocked if another configuration still depends on it
app.delete('/api/configurations/:id', async (req, res) => {
    try {
        const [[target]] = await pool.query('SELECT name FROM configurations WHERE id = ?', [req.params.id]);
        if (!target) {
            return res.status(404).json({ error: 'Configuration not found' });
        }

        const [rows] = await pool.query('SELECT name, depends_on FROM configurations WHERE id != ?', [req.params.id]);
        const dependents = rows
            .map(parseDependsOn)
            .filter(row => row.depends_on.some(dep => (typeof dep === 'string' ? dep : dep.name) === target.name))
            .map(row => row.name);

        if (dependents.length > 0) {
            return res.status(409).json({ error: 'Configuration is still depended on', dependents });
        }

        const [attachments] = await pool.query('SELECT object_key FROM attachments WHERE configuration_id = ?', [req.params.id]);
        if (attachments.length > 0) {
            await minioClient.removeObjects(process.env.MINIO_BUCKET, attachments.map(a => a.object_key));
        }

        await pool.query('DELETE FROM configurations WHERE id = ?', [req.params.id]);
        res.status(204).send();
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// POST a new attachment for a configuration
app.post('/api/configurations/:id/attachments', upload.single('file'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }

    const originalName = path.basename(req.file.originalname);
    const objectKey = `${req.params.id}/${crypto.randomUUID()}-${originalName}`;

    try {
        await minioClient.fPutObject(process.env.MINIO_BUCKET, objectKey, req.file.path, {
            'Content-Type': req.file.mimetype || 'application/octet-stream'
        });

        const [result] = await pool.query(
            'INSERT INTO attachments (configuration_id, object_key, original_name, mime_type, size_bytes) VALUES (?, ?, ?, ?, ?)',
            [req.params.id, objectKey, originalName, req.file.mimetype, req.file.size]
        );

        res.status(201).json({
            id: result.insertId,
            configuration_id: Number(req.params.id),
            original_name: originalName,
            mime_type: req.file.mimetype,
            size_bytes: req.file.size
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    } finally {
        fs.unlink(req.file.path, () => {});
    }
});

// PUT rename an attachment
app.put('/api/attachments/:attachmentId', async (req, res) => {
    const originalName = path.basename(String(req.body.original_name || '').trim());
    if (!originalName) {
        return res.status(400).json({ error: 'original_name is required' });
    }

    try {
        const [result] = await pool.query(
            'UPDATE attachments SET original_name = ? WHERE id = ?',
            [originalName, req.params.attachmentId]
        );
        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Attachment not found' });
        }
        res.json({ id: Number(req.params.attachmentId), original_name: originalName });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// DELETE an attachment
app.delete('/api/attachments/:attachmentId', async (req, res) => {
    try {
        const [[attachment]] = await pool.query('SELECT object_key FROM attachments WHERE id = ?', [req.params.attachmentId]);
        if (!attachment) {
            return res.status(404).json({ error: 'Attachment not found' });
        }

        await minioClient.removeObject(process.env.MINIO_BUCKET, attachment.object_key);
        await pool.query('DELETE FROM attachments WHERE id = ?', [req.params.attachmentId]);
        res.status(204).send();
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// GET a presigned download URL and redirect to it
app.get('/api/attachments/:attachmentId/download', async (req, res) => {
    try {
        const [[attachment]] = await pool.query('SELECT object_key, original_name FROM attachments WHERE id = ?', [req.params.attachmentId]);
        if (!attachment) {
            return res.status(404).json({ error: 'Attachment not found' });
        }

        const url = await minioClient.presignedGetObject(process.env.MINIO_BUCKET, attachment.object_key, 300, {
            'response-content-disposition': `attachment; filename="${attachment.original_name}"`
        });
        res.redirect(url);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

const PORT = process.env.PORT || 3000;
Promise.all([setupDatabase(), setupMinio()]).then(() => {
    app.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`);
    });
}).catch(err => {
    console.error('Failed to start server:', err);
    process.exit(1);
});
