const { Client } = require('ssh2');
const net = require('net');

const sshClient = new Client();

const server = net.createServer(socket => {
    sshClient.forwardOut(
        socket.remoteAddress,
        socket.remotePort,
        '127.0.0.1',
        3306,
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
    console.log('SSH connection established');
    server.listen(3308, '127.0.0.1', () => {
        console.log('Local port forwarder listening on port 3308');
        // Test it
        const mysql = require('mysql2/promise');
        mysql.createConnection({
            host: '127.0.0.1',
            port: 3308,
            user: 'vulndb',
            password: 'WhoAreYou',
            database: 'vulns'
        }).then(async conn => {
            console.log('MySQL connected!');
            const [rows] = await conn.query('SELECT 1');
            console.log(rows);
            conn.end();
            server.close();
            sshClient.end();
        }).catch(err => console.error(err));
    });
}).on('error', err => {
    console.error('SSH error:', err);
});

sshClient.connect({
    host: '10.67.2.29',
    port: 22,
    username: 'dbuser',
    password: 'sqordfish01'
});
