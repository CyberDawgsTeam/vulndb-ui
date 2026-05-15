const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const { Client } = require('ssh2');
const net = require('net');

let pool;

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

// GET all vulnerabilities
app.get('/api/vulns', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM vulnerabilities');
        res.json(rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// POST a new vulnerability
app.post('/api/vulns', async (req, res) => {
    const { name, platform, target } = req.body;
    try {
        const [result] = await pool.query(
            'INSERT INTO vulnerabilities (name, platform, target) VALUES (?, ?, ?)',
            [name, platform, target]
        );
        res.status(201).json({ id: result.insertId, name, platform, target });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// PUT update a vulnerability
app.put('/api/vulns/:id', async (req, res) => {
    const { name, platform, target } = req.body;
    try {
        await pool.query(
            'UPDATE vulnerabilities SET name = ?, platform = ?, target = ? WHERE id = ?',
            [name, platform, target, req.params.id]
        );
        res.json({ id: req.params.id, name, platform, target });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// DELETE a vulnerability
app.delete('/api/vulns/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM vulnerabilities WHERE id = ?', [req.params.id]);
        res.status(204).send();
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// GET all misconfigs
app.get('/api/misconfigs', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM misconfigs');
        res.json(rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// POST a new misconfig
app.post('/api/misconfigs', async (req, res) => {
    const { vuln_id, type, script, run_as } = req.body;
    try {
        const [result] = await pool.query(
            'INSERT INTO misconfigs (vuln_id, type, script, run_as) VALUES (?, ?, ?, ?)',
            [vuln_id, type, script, run_as]
        );
        res.status(201).json({ id: result.insertId, vuln_id, type, script, run_as });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// PUT update a misconfig
app.put('/api/misconfigs/:id', async (req, res) => {
    const { vuln_id, type, script, run_as } = req.body;
    try {
        await pool.query(
            'UPDATE misconfigs SET vuln_id = ?, type = ?, script = ?, run_as = ? WHERE id = ?',
            [vuln_id, type, script, run_as, req.params.id]
        );
        res.json({ id: req.params.id, vuln_id, type, script, run_as });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// DELETE a misconfig
app.delete('/api/misconfigs/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM misconfigs WHERE id = ?', [req.params.id]);
        res.status(204).send();
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

const PORT = process.env.PORT || 3000;
setupDatabase().then(() => {
    app.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`);
    });
}).catch(err => {
    console.error('Failed to start server:', err);
    process.exit(1);
});
