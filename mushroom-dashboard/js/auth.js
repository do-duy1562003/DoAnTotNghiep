/**
 * NấmSmart — Authentication Module (client-side)
 */

class NasSmartAuth {
  constructor() {
    this.token = localStorage.getItem('nasmart_token');
    this.user = localStorage.getItem('nasmart_user') ? 
               JSON.parse(localStorage.getItem('nasmart_user')) : null;
  }

  /**
   * Kiểm tra xem người dùng đã đăng nhập chưa
   */
  isAuthenticated() {
    return !!this.token;
  }

  /**
   * Nếu không đăng nhập, chuyển hướng đến login
   */
  requireAuth() {
    if (!this.isAuthenticated()) {
      window.location.href = 'login.html';
    }
  }

  /**
   * Lấy token để dùng trong API request
   */
  getAuthHeader() {
    return {
      'Authorization': `Bearer ${this.token}`
    };
  }

  /**
   * Đăng xuất
   */
  logout() {
    localStorage.removeItem('nasmart_token');
    localStorage.removeItem('nasmart_user');
    window.location.href = 'login.html';
  }

  /**
   * Lấy thông tin người dùng hiện tại
   */
  getCurrentUser() {
    return this.user;
  }

  /**
   * Cập nhật tên hiển thị trên giao diện
   */
  updateUserDisplay() {
    if (!this.user) return;
    
    const nameElement = document.querySelector('.student-name');
    if (nameElement) {
      nameElement.textContent = this.user.name || this.user.username;
    }

    const avatarElement = document.querySelector('.student-avatar');
    if (avatarElement) {
      const initials = (this.user.name || this.user.username)
        .split(' ')
        .map(n => n[0])
        .join('')
        .toUpperCase();
      avatarElement.textContent = initials.slice(0, 2);
    }
  }
}

// Export cho sử dụng toàn cục
const nasSmartAuth = new NasSmartAuth();

// Kiểm tra xác thực khi trang tải
document.addEventListener('DOMContentLoaded', () => {
  nasSmartAuth.requireAuth();
  nasSmartAuth.updateUserDisplay();
});
