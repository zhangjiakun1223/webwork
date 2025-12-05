require('dotenv').config();

const express = require('express');
const path = require('path');
const fs = require('fs');
const { query, testConnection, initializeDatabase } = require('./db-config-mysql');
const { sendVerificationEmail, testEmailConfig } = require('./email-config'); // 添加这行

const app = express();
const PORT = process.env.PORT ;

// 中间件
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(__dirname));
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    // 添加移动端相关header
    res.header('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.header('Pragma', 'no-cache');
    res.header('Expires', '0');
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});

// 存储活跃会话（生产环境应使用Redis）
const activeSessions = new Map();

// 生成token
function generateToken() {
    return Math.random().toString(36).substring(2) + Date.now().toString(36);
}

// 认证中间件
function requireAuth(req) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return null;
    }
    const token = authHeader.substring(7);
    return activeSessions.get(token) || null;
}

// 静态文件服务函数
function serveStaticFile(req, res) {
    let filePath = req.path;

    // 默认文件
    if (filePath === '/') {
        filePath = '/index.html';
    }

    const fullPath = path.join(__dirname, filePath);

    // 安全检查：防止路径遍历攻击
    if (!fullPath.startsWith(__dirname)) {
        res.status(403).json({ error: '禁止访问' });
        return;
    }

    // 检查文件是否存在
    fs.access(fullPath, fs.constants.F_OK, (err) => {
        if (err) {
            // 如果文件不存在，返回首页（用于SPA）
            res.sendFile(path.join(__dirname, 'index.html'));
            return;
        }

        const ext = path.extname(filePath);
        const contentType = {
            '.html': 'text/html',
            '.css': 'text/css',
            '.js': 'application/javascript',
            '.json': 'application/json',
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.gif': 'image/gif',
            '.ico': 'image/x-icon',
            '.svg': 'image/svg+xml'
        }[ext] || 'text/plain';

        res.sendFile(fullPath, {
            headers: {
                'Content-Type': contentType + '; charset=utf-8'
            }
        });
    });
}

// API 路由

// 健康检查
app.get('/health', (req, res) => {
    res.json({
        status: 'OK',
        message: '服务器运行正常',
        timestamp: new Date().toISOString()
    });
});

// 数据库测试
app.get('/test-db', async (req, res) => {
    try {
        const result = await query('SELECT 1 + 1 AS solution');
        res.json({
            success: true,
            message: '数据库连接正常',
            data: result[0]
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: '数据库连接失败',
            error: error.message
        });
    }
});

// 获取所有留言
app.get('/api/messages', async (req, res) => {
    try {
        const messages = await query('SELECT * FROM messages ORDER BY timestamp DESC');
        res.json(messages);
    } catch (error) {
        console.error('获取留言失败:', error);
        res.status(500).json({ error: '获取留言失败' });
    }
});

// 发布留言
app.post('/api/messages', async (req, res) => {
    try {
        const { author, content } = req.body;

        if (!author || !content) {
            return res.status(400).json({ error: '作者和内容不能为空' });
        }

        // 检查用户是否登录
        const user = requireAuth(req);
        const userId = user ? user.id : null;

        const result = await query(
            'INSERT INTO messages (author, content, user_id) VALUES (?, ?, ?)',
            [author, content, userId]
        );

        res.json({
            success: true,
            message: '留言发布成功',
            id: result.insertId
        });
    } catch (error) {
        console.error('发布留言失败:', error);
        res.status(500).json({ error: '发布留言失败' });
    }
});

// 删除留言
app.delete('/api/messages/:id', async (req, res) => {
    try {
        const messageId = parseInt(req.params.id);
        if (isNaN(messageId)) {
            return res.status(400).json({ error: '无效的留言ID' });
        }

        const result = await query('DELETE FROM messages WHERE id = ?', [messageId]);

        if (result.affectedRows > 0) {
            res.json({ message: '留言删除成功' });
        } else {
            res.status(404).json({ error: '留言不存在' });
        }
    } catch (error) {
        console.error('删除留言失败:', error);
        res.status(500).json({ error: '删除留言失败' });
    }
});

// 用户注册
app.post('/api/register', async (req, res) => {
    try {
        const { username, email, password, firstName, lastName } = req.body;

        // 基本验证
        if (!username || !email || !password) {
            return res.status(400).json({ error: '用户名、邮箱和密码不能为空' });
        }

        // 密码强度验证
        if (password.length < 6) {
            return res.status(400).json({ error: '密码长度至少6位' });
        }

        // 邮箱格式验证
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({ error: '邮箱格式不正确' });
        }

        // 检查用户是否已存在
        const existingUsers = await query(
            'SELECT id FROM users WHERE username = ? OR email = ?',
            [username, email]
        );

        if (existingUsers.length > 0) {
            return res.status(409).json({ error: '用户名或邮箱已存在' });
        }

        // 密码加密
        const bcrypt = require('bcryptjs');
        const passwordHash = await bcrypt.hash(password, 10);

        // 创建用户
        const result = await query(
            `INSERT INTO users (username, email, password_hash, first_name, last_name) 
             VALUES (?, ?, ?, ?, ?)`,
            [username, email, passwordHash, firstName, lastName]
        );

        res.status(201).json({
            success: true,
            message: '注册成功',
            userId: result.insertId
        });

    } catch (error) {
        console.error('注册失败:', error);
        res.status(500).json({ error: '注册失败' });
    }
});

// 用户登录
app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;

        if (!username || !password) {
            return res.status(400).json({ error: '用户名和密码不能为空' });
        }

        // 查找用户
        const users = await query(
            'SELECT * FROM users WHERE username = ? OR email = ?',
            [username, username]
        );

        if (users.length === 0) {
            return res.status(401).json({ error: '用户不存在' });
        }

        const user = users[0];

        // 验证密码
        const bcrypt = require('bcryptjs');
        const isValid = await bcrypt.compare(password, user.password_hash);

        if (!isValid) {
            return res.status(401).json({ error: '密码错误' });
        }

        // 生成token
        const token = generateToken();
        activeSessions.set(token, {
            id: user.id,
            username: user.username,
            email: user.email,
            firstName: user.first_name,
            lastName: user.last_name
        });

        res.json({
            success: true,
            message: '登录成功',
            token: token,
            user: {
                id: user.id,
                username: user.username,
                email: user.email,
                firstName: user.first_name,
                lastName: user.last_name
            }
        });

    } catch (error) {
        console.error('登录失败:', error);
        res.status(500).json({ error: '登录失败' });
    }
});

// 在 server.js 中添加 token 验证接口
app.get('/api/verify-token', (req, res) => {
    try {
        const user = requireAuth(req);
        if (user) {
            res.json({
                success: true,
                user: user
            });
        } else {
            res.status(401).json({
                success: false,
                error: 'Token无效或已过期'
            });
        }
    } catch (error) {
        console.error('验证token失败:', error);
        res.status(500).json({
            success: false,
            error: '服务器错误'
        });
    }
});
// 获取用户留言
app.get('/api/my-messages', async (req, res) => {
    try {
        const user = requireAuth(req);
        if (!user) {
            return res.status(401).json({ error: '未授权访问' });
        }

        const messages = await query(
            'SELECT * FROM messages WHERE user_id = ? ORDER BY timestamp DESC',
            [user.id]
        );

        res.json(messages);
    } catch (error) {
        console.error('获取用户留言失败:', error);
        res.status(500).json({ error: '获取用户留言失败' });
    }
});

// 用户注销
app.post('/api/logout', (req, res) => {
    try {
        const user = requireAuth(req);
        if (user) {
            const authHeader = req.headers.authorization;
            if (authHeader && authHeader.startsWith('Bearer ')) {
                const token = authHeader.substring(7);
                activeSessions.delete(token);
            }
        }

        res.json({ message: '注销成功' });
    } catch (error) {
        console.error('注销错误:', error);
        res.status(500).json({ error: '注销失败' });
    }
});

// 搜索留言
app.get('/api/search', async (req, res) => {
    try {
        const { q: keyword } = req.query;

        if (!keyword) {
            return res.status(400).json({ error: '搜索关键词不能为空' });
        }

        const searchTerm = `%${keyword}%`;
        const messages = await query(
            'SELECT * FROM messages WHERE author LIKE ? OR content LIKE ? ORDER BY timestamp DESC',
            [searchTerm, searchTerm]
        );

        res.json(messages);
    } catch (error) {
        console.error('搜索留言失败:', error);
        res.status(500).json({ error: '搜索留言失败' });
    }
});

// 验证重置密码验证码
app.post('/api/password-reset/verify-code', async (req, res) => {
    try {
        const { email, verificationCode } = req.body;

        if (!email || !verificationCode) {
            return res.status(400).json({ error: '邮箱和验证码不能为空' });
        }

        console.log(`🔍 验证验证码: email=${email}, code=${verificationCode}`);

        // 查找有效的验证码
        const resetCodes = await query(
            'SELECT * FROM password_resets WHERE email = ? AND verification_code = ? AND expires_at > NOW() AND used = 0',
            [email, verificationCode]
        );

        console.log(`📊 查询结果: ${resetCodes.length} 条记录`);

        if (resetCodes.length === 0) {
            // 检查是否是过期还是不存在
            const expiredCodes = await query(
                'SELECT * FROM password_resets WHERE email = ? AND verification_code = ? AND used = 0',
                [email, verificationCode]
            );

            if (expiredCodes.length > 0) {
                console.log('⚠️  验证码已过期');
                return res.status(400).json({ error: '验证码已过期，请重新获取' });
            }

            console.log('❌ 验证码不存在');
            return res.status(400).json({ error: '验证码无效' });
        }

        // 标记验证码为已使用
        await query('UPDATE password_resets SET used = 1 WHERE id = ?', [resetCodes[0].id]);

        // 生成重置令牌
        const resetToken = generateToken();

        res.json({
            success: true,
            message: '验证成功',
            resetToken: resetToken
        });

    } catch (error) {
        console.error('❌ 验证验证码失败:', error);
        res.status(500).json({
            error: '验证验证码失败',
            details: error.message
        });
    }
});

// 更新密码
app.post('/api/password-reset/update', async (req, res) => {
    try {
        const { email, resetToken, newPassword, confirmPassword } = req.body;

        console.log(`🔄 更新密码请求: email=${email}, token=${resetToken}`);

        if (!email || !resetToken || !newPassword || !confirmPassword) {
            return res.status(400).json({ error: '所有字段都是必需的' });
        }

        if (newPassword !== confirmPassword) {
            return res.status(400).json({ error: '两次输入的密码不一致' });
        }

        // 密码强度验证
        if (newPassword.length < 6) {
            return res.status(400).json({ error: '密码长度至少6位' });
        }

        if (!/[a-zA-Z]/.test(newPassword)) {
            return res.status(400).json({ error: '密码必须包含至少一个字母' });
        }

        if (!/\d/.test(newPassword)) {
            return res.status(400).json({ error: '密码必须包含至少一个数字' });
        }

        // 注意：这里简化了resetToken验证
        // 在实际应用中，应该验证resetToken的有效性（比如存储在数据库中）

        // 更新用户密码
        const bcrypt = require('bcryptjs');
        const passwordHash = await bcrypt.hash(newPassword, 10);

        const result = await query(
            'UPDATE users SET password_hash = ? WHERE email = ?',
            [passwordHash, email]
        );

        console.log(`📊 数据库更新结果: affectedRows=${result.affectedRows}`);

        if (result.affectedRows === 0) {
            return res.status(404).json({ error: '用户不存在' });
        }

        res.json({
            success: true,
            message: '密码更新成功'
        });

    } catch (error) {
        console.error('❌ 更新密码失败:', error);
        res.status(500).json({
            error: '更新密码失败',
            details: error.message
        });
    }
});


// 获取留言统计
app.get('/api/stats', async (req, res) => {
    try {
        const totalResult = await query('SELECT COUNT(*) as total FROM messages');
        const todayResult = await query(
            'SELECT COUNT(*) as today FROM messages WHERE DATE(timestamp) = CURDATE()'
        );

        res.json({
            total: totalResult[0].total,
            today: todayResult[0].today
        });
    } catch (error) {
        console.error('获取统计失败:', error);
        res.status(500).json({ error: '获取统计失败' });
    }
});


// 验证重置密码验证码
app.post('/api/password-reset/send-code', async (req, res) => {
    try {
        const { email } = req.body;

        if (!email) {
            return res.status(400).json({ error: '邮箱不能为空' });
        }

        console.log(`📧 尝试发送验证码到: ${email}`);

        // 检查邮箱是否存在
        const users = await query('SELECT * FROM users WHERE email = ?', [email]);
        if (users.length === 0) {
            console.log(`❌ 邮箱未注册: ${email}`);
            return res.status(404).json({ error: '该邮箱未注册' });
        }

        // 生成6位随机验证码
        const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();

        // 设置过期时间（1分钟后）
        const expiresAt = new Date(Date.now() +  60 * 1000);

        // 删除该邮箱之前的验证码
        await query('DELETE FROM password_resets WHERE email = ?', [email]);

        // 保存验证码到数据库
        await query(
            'INSERT INTO password_resets (email, verification_code, expires_at) VALUES (?, ?, ?)',
            [email, verificationCode, expiresAt]
        );

        console.log(`📦 验证码已保存到数据库: ${verificationCode}`);

        try {
            // 发送邮件
            const emailResult = await sendVerificationEmail(email, verificationCode);

            if (emailResult.success) {
                console.log(`✅ 邮件发送成功: ${email}`);
                console.log(`   消息ID: ${emailResult.messageId}`);
                console.log(`   服务器响应: ${emailResult.response}`);

                res.json({
                    success: true,
                    message: '验证码已发送到您的邮箱',
                    // 开发环境仍返回验证码便于测试
                    debugCode: process.env.NODE_ENV === 'development' ? verificationCode : undefined
                });
            } else {
                console.log(`❌ 邮件发送失败:`, emailResult.error);
                console.log(`   错误代码: ${emailResult.code}`);

                // 如果邮件发送失败，返回验证码供测试
                console.log(`   测试验证码: ${verificationCode}`);
                res.json({
                    success: false,
                    message: '邮件发送失败，请在控制台查看验证码',
                    debugCode: verificationCode,
                    error: emailResult.error
                });
            }

        } catch (emailError) {
            console.error('📧 邮件发送异常:', emailError);
            console.log(`   临时验证码: ${verificationCode}`);

            res.json({
                success: false,
                message: '邮件发送异常，请在控制台查看验证码',
                debugCode: verificationCode,
                error: emailError.message
            });
        }

    } catch (error) {
        console.error('❌ 发送验证码失败:', error);
        res.status(500).json({
            error: '发送验证码失败',
            details: error.message
        });
    }
});
async function testEmailService() {
    try {
        console.log('📧 正在测试邮件服务...');

        // 发送测试邮件
        const testEmail = 'test123@qq.com'; // 改为你的测试邮箱
        const testCode = '123456';

        const result = await sendVerificationEmail(testEmail, testCode);

        if (result.success) {
            console.log('✅ 邮件发送成功！');
            console.log(`   测试邮件已发送到: ${testEmail}`);
            console.log(`   验证码: ${testCode}`);
            console.log(`   Message ID: ${result.messageId}`);
            return true;
        } else {
            console.log('❌ 邮件发送失败:', result.error);
            return false;
        }
    } catch (error) {
        console.error('❌ 邮件测试失败:', error.message);
        return false;
    }
}

// 显式定义所有HTML页面的路由
app.get(['/', '/index.html'], (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/login.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'login.html'));
});

app.get('/register.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'register.html'));
});

app.get('/post.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'post.html'));
});

app.get('/my.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'my.html'));
});

app.get('/reset-password.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'reset-password.html'));
});

// 处理所有其他路由 - 使用明确的路径模式而不是 *
app.get('/:page', (req, res) => {
    const page = req.params.page;
    const validPages = ['index', 'login', 'register', 'post', 'my', 'reset-password'];

    if (validPages.includes(page)) {
        res.sendFile(path.join(__dirname, `${page}.html`));
    } else {
        // 如果请求的页面不存在，返回404或重定向到首页
        res.status(404).json({ error: '页面！存在' });
    }
});

// 错误处理中间件
app.use((err, req, res, next) => {
    console.error('服务器错误:', err);
    res.status(500).json({ error: '服务器内部错误' });
});



// 启动服务器
async function startServer() {
    try {
        console.log('🚀 正在启动留言板系统...');

        // 测试数据库连接
        console.log('📊 正在连接数据库...');
        await testConnection();

        // 初始化数据库
        console.log('🗄️  正在初始化数据库...');
        await initializeDatabase();

        // 测试邮件服务
        console.log('📧 正在测试邮件服务...');
        const emailTestResult = await testEmailService();

        if (!emailTestResult) {
            console.log('⚠️  邮件服务配置有误，请检查以下问题：');
            console.log('   1. QQ邮箱授权码是否正确');
            console.log('   2. 是否开启了SMTP服务');
            console.log('   3. 网络连接是否正常');
            console.log('   验证码将以控制台输出方式提供');
        }

        // 启动HTTP服务器
        app.listen(PORT, '0.0.0.0', () => {
            console.log('🎉 ===========================================');
            console.log('✅ 服务器启动成功!');
            console.log(`📍 访问地址: http://localhost:${PORT}`);
            console.log(`📧 邮件服务: ${emailTestResult ? '✅ 正常' : '❌ 异常'}`);
            console.log('👤 密码重置功能需要邮件服务支持');
            console.log('🎉 ===========================================');
        });

    } catch (error) {
        console.error('❌ 启动失败:', error.message);
        process.exit(1);
    }
}

// 处理进程退出
process.on('SIGINT', () => {
    console.log('\n🛑 服务器正在关闭...');
    process.exit(0);
});

// 启动应用
startServer();