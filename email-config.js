require('dotenv').config();

const nodemailer = require('nodemailer');

// 邮件配置（使用QQ邮箱示例）
const emailConfig = {
    host: process.env.EMAIL_HOST ,
    port: parseInt(process.env.EMAIL_PORT) ,
    secure: true,
    auth: {
        user: process.env.EMAIL_USER ,
        pass: process.env.EMAIL_PASS ,
    }
};

// 创建邮件传输器
const transporter = nodemailer.createTransport(emailConfig);

// 发送邮件函数
async function sendVerificationEmail(email, verificationCode) {
    try {
        console.log('📧 ===========================================');
        console.log(`📧 [发送前] 准备发送邮件到: ${email}`);
        console.log(`📧 发件人: ${emailConfig.auth.user}`);
        console.log(`📧 验证码: ${verificationCode}`);

        const mailOptions = {
            from: `"留言板系统" <${emailConfig.auth.user}>`,
            to: email,
            subject: '留言板系统 - 密码重置验证码',
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                    <h2 style="color: #333;">留言板系统 - 密码重置验证码</h2>
                    <p>您好！</p>
                    <p>您正在尝试重置密码，请使用以下验证码完成验证：</p>
                    <div style="background: #f5f5f5; padding: 20px; margin: 20px 0; text-align: center; font-size: 24px; font-weight: bold; color: #667eea;">
                        ${verificationCode}
                    </div>
                    <p>验证码将在 1 分钟后过期。</p>
                    <p>如果您没有请求重置密码，请忽略此邮件。</p>
                    <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
                    <p style="color: #666; font-size: 12px;">此邮件由留言板系统自动发送，请勿回复。</p>
                </div>
            `,
            text: `您的密码重置验证码是: ${verificationCode}，该验证码将在10分钟后过期。`,
            headers: {
                'X-Priority': '1',
                'Importance': 'high'
            }
        };

        console.log('📧 [发送中] 调用 transporter.sendMail()');

        // 先验证连接
        console.log('📧 验证邮件服务器连接...');
        await transporter.verify();
        console.log('✅ 邮件服务器连接验证成功');

        const info = await transporter.sendMail(mailOptions);

        console.log('✅ [发送后] 邮件发送完成');
        console.log(`   消息ID: ${info.messageId}`);
        console.log(`   响应: ${info.response}`);
        console.log(`   收件人: ${info.accepted}`);
        console.log(`   响应代码: ${info.responseCode}`);
        console.log('📧 ===========================================');

        if (info.response && info.response.includes('250')) {
            return {
                success: true,
                messageId: info.messageId,
                response: info.response
            };
        } else {
            return {
                success: false,
                error: '邮件服务器响应异常',
                response: info.response
            };
        }
    } catch (error) {
        console.error('❌ 邮件发送失败详情:');
        console.error(`   目标邮箱: ${email}`);
        console.error(`   错误名称: ${error.name}`);
        console.error(`   错误代码: ${error.code}`);
        console.error(`   错误消息: ${error.message}`);

        // 如果是网络错误
        if (error.code === 'ECONNECTION' || error.code === 'ETIMEDOUT') {
            console.error('   这是网络连接问题，邮件并未发送');
        }

        // 如果是认证错误
        if (error.code === 'EAUTH') {
            console.error('   认证失败，请检查邮箱用户名和授权码');
        }

        return {
            success: false,
            error: error.message,
            code: error.code
        };
    }
}

// 测试邮件配置
async function testEmailConfig() {
    try {
        await transporter.verify();
        console.log('✅ 邮件服务器连接成功');
        return true;
    } catch (error) {
        console.error('❌ 邮件服务器连接失败:', error);
        return false;
    }
}

module.exports = {
    sendVerificationEmail,
    testEmailConfig
};