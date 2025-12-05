// auth.js - 通用认证函数

// 检查用户是否已登录
function isLoggedIn() {
    const token = localStorage.getItem('authToken');
    const userStr = localStorage.getItem('user');

    return !!(token && userStr);
}

// 获取当前用户信息
function getCurrentUser() {
    try {
        return JSON.parse(localStorage.getItem('user') || 'null');
    } catch (error) {
        console.error('获取用户信息失败:', error);
        return null;
    }
}

// 检查登录状态并更新页面
function checkAndUpdateAuth() {
    const user = getCurrentUser();

    if (user) {
        // 更新页面的登录状态
        updatePageAuthStatus(user);
        return true;
    }
    return false;
}

// 更新页面上的认证状态
function updatePageAuthStatus(user) {
    // 更新导航栏
    const authButtons = document.querySelector('.auth-buttons');
    if (authButtons) {
        authButtons.innerHTML = `
            <span style="color: white; margin-right: 10px;">欢迎，${user.username}</span>
            <a href="my.html" class="auth-btn">📝 我的留言</a>
            <a href="post.html" class="auth-btn">✏️ 发布留言</a>
            <a href="#" onclick="logout()" class="auth-btn">🚪 退出</a>
        `;
    }

    // 隐藏登录提示
    const loginPrompt = document.querySelector('.login-prompt');
    if (loginPrompt) {
        loginPrompt.style.display = 'none';
    }
}

// 退出登录
function logout() {
    if (confirm('确定要退出登录吗？')) {
        // 调用服务器的注销API（可选）
        const token = localStorage.getItem('authToken');
        if (token) {
            fetch('/api/logout', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            }).catch(console.error);
        }

        // 清除本地存储
        localStorage.removeItem('authToken');
        localStorage.removeItem('user');

        // 刷新页面
        window.location.reload();
    }
    return false;
}

// 保护页面需要登录
function protectPage(redirectToLogin = true) {
    if (!isLoggedIn()) {
        if (redirectToLogin) {
            // 保存当前URL以便登录后返回
            localStorage.setItem('redirectUrl', window.location.pathname);
            window.location.href = 'login.html';
        }
        return false;
    }
    return true;
}

// 初始化页面认证状态
document.addEventListener('DOMContentLoaded', function() {
    checkAndUpdateAuth();
});