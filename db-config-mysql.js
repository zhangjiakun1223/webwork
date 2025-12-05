const mysql = require('mysql2');
const bcrypt = require('bcryptjs');

// 数据库配置
const dbConfigMysql = {
    host: process.env.DB_HOST ,
    user: process.env.DB_USER ,
    password: process.env.DB_PASSWORD ,
    database: process.env.DB_NAME ,
    port: process.env.DB_PORT,
    connectionLimit: 10,
    acquireTimeout: 60000,
    timeout: 60000,
    reconnect: true,
    charset: 'utf8mb4'
};

// 创建连接池
const pool = mysql.createPool(dbConfigMysql);

// Promise 包装的查询函数
function query(sql, params = []) {
    return new Promise((resolve, reject) => {
        pool.getConnection((err, connection) => {
            if (err) {
                console.error('获取数据库连接失败:', err);
                reject(err);
                return;
            }

            connection.query(sql, params, (error, results) => {
                connection.release();
                if (error) {
                    console.error('数据库查询失败:', error);
                    reject(error);
                } else {
                    resolve(results);
                }
            });
        });
    });
}

// 测试数据库连接
async function testConnection() {
    return new Promise((resolve, reject) => {
        pool.getConnection((err, connection) => {
            if (err) {
                console.error('❌ MySQL数据库连接失败:', err.message);
                reject(err);
                return;
            }

            console.log('✅ MySQL数据库连接成功');
            connection.ping((pingErr) => {
                connection.release();
                if (pingErr) {
                    console.error('❌ 数据库ping测试失败:', pingErr.message);
                    reject(pingErr);
                } else {
                    console.log('✅ 数据库ping测试成功');
                    resolve(true);
                }
            });
        });
    });
}

// 初始化数据库表
async function initializeDatabase() {
    try {
        // 创建数据库（如果不存在）
        await query('CREATE DATABASE IF NOT EXISTS ?? CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci', [dbConfigMysql.database]);
        console.log('✅ 数据库创建/验证成功');

        // 使用数据库
        await query('USE ??', [dbConfigMysql.database]);

        // 创建用户表
        await query(`
            CREATE TABLE IF NOT EXISTS users (
                id INT AUTO_INCREMENT PRIMARY KEY,
                username VARCHAR(50) UNIQUE NOT NULL,
                email VARCHAR(100) UNIQUE NOT NULL,
                password_hash VARCHAR(255) NOT NULL,
                first_name VARCHAR(50),
                last_name VARCHAR(50),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX idx_username (username),
                INDEX idx_email (email)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);

        // 创建留言表
        await query(`
            CREATE TABLE IF NOT EXISTS messages (
                id INT AUTO_INCREMENT PRIMARY KEY,
                user_id INT,
                author VARCHAR(100) NOT NULL,
                content TEXT NOT NULL,
                timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
                INDEX idx_author (author),
                INDEX idx_timestamp (timestamp)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);

        //创建密码重置表
        await query(`
            CREATE TABLE IF NOT EXISTS password_resets (
                id INT AUTO_INCREMENT PRIMARY KEY,
                email VARCHAR(100) NOT NULL,
                verification_code VARCHAR(10) NOT NULL,
                expires_at TIMESTAMP NOT NULL,
                used TINYINT(1) DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_email (email),
                INDEX idx_code (verification_code),
                INDEX idx_expires (expires_at)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);


        console.log('✅ 数据表创建成功');

        // 插入示例数据
        await insertSampleData();

    } catch (error) {
        console.error('❌ 数据库初始化失败:', error);
        throw error;
    }
}

// 插入示例数据
async function insertSampleData() {
    try {
        // 检查是否已有留言数据
        const messageCount = await query('SELECT COUNT(*) as count FROM messages');
        if (messageCount[0].count === 0) {
            // 插入示例留言
            await query(
                'INSERT INTO messages (author, content) VALUES (?, ?)',
                ['系统管理员', 'MySQL数据库连接成功！欢迎使用留言板系统。']
            );

            await query(
                'INSERT INTO messages (author, content, timestamp) VALUES (?, ?, ?)',
                ['测试用户', '这是一个测试留言，系统现在使用MySQL数据库存储数据。', new Date(Date.now() - 3600000)]
            );

            console.log('✅ 示例留言数据插入成功');
        }

        // 检查是否已有用户数据
        const userCount = await query('SELECT COUNT(*) as count FROM users');
        if (userCount[0].count === 0) {
            // 插入示例用户（密码都是123456）
            const hashedPassword = await bcrypt.hash('123456', 10);

            await query(
                'INSERT INTO users (username, email, password_hash, first_name, last_name) VALUES (?, ?, ?, ?, ?)',
                ['admin', 'admin@example.com', hashedPassword, '系统', '管理员']
            );

            await query(
                'INSERT INTO users (username, email, password_hash, first_name, last_name) VALUES (?, ?, ?, ?, ?)',
                ['testuser', 'test@example.com', hashedPassword, '测试', '用户']
            );

            console.log('✅ 示例用户数据插入成功');
        }
    } catch (error) {
        console.error('示例数据插入失败:', error);
    }
}

// 关闭数据库连接池
function closePool() {
    return new Promise((resolve) => {
        pool.end((err) => {
            if (err) {
                console.error('关闭数据库连接池失败:', err);
            } else {
                console.log('✅ 数据库连接池已关闭');
            }
            resolve();
        });
    });
}

//留言搜索
async function searchMessages(keyword) {
    const sql = `
        SELECT * FROM messages 
        WHERE author LIKE ? OR content LIKE ? 
        ORDER BY timestamp DESC
    `;
    const params = [`%${keyword}%`, `%${keyword}%`]; // 模糊匹配关键词
    return await query(sql, params); // 复用已有的 query 函数
}


module.exports = {
    pool,
    query,
    testConnection,
    initializeDatabase,
    closePool,
    searchMessages,
};