// Config file for API URLs
// ✅ Auto-detects localhost vs production environment

const CONFIG = {
    // ✅ Automatically detect environment based on hostname
    API_URL: (() => {
        const hostname = window.location.hostname;
        const protocol = window.location.protocol;
        
        // Development/Localhost
        if (hostname === 'localhost' || hostname === '127.0.0.1') {
            return 'http://localhost:5000';
        }

        // Production - Auto-detect
        // AWS Nginx internally routes to 5000, so we just return the base URL
        return protocol + '//' + hostname ; 
    })(),
    
    // Frontend URL (same logic)
    FRONTEND_URL: (() => {
        const hostname = window.location.hostname;
        const protocol = window.location.protocol;
        
        if (hostname === 'localhost' || hostname === '127.0.0.1') {
            return 'http://localhost:5000';
        }
        
        return protocol + '//' + hostname;
    })(),
    
    // Helper function to get full API endpoint
    getApiUrl: function(endpoint) {
        return this.API_URL + endpoint;
    },
    
    // Helper function to get full frontend URL  
    getFrontendUrl: function(path) {
        return this.FRONTEND_URL + '/' + path;
    },
    
    // Environment detection
    isDevelopment: function() {
        return window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    },
    
    isProduction: function() {
        return !this.isDevelopment();
    }
};

// Make it available globally
if (typeof window !== 'undefined') {
    window.CONFIG = CONFIG;
    
    // Debug logging in development
    if (CONFIG.isDevelopment()) {
        console.log('🔧 Development Mode');
        console.log('API URL:', CONFIG.API_URL);
        console.log('Frontend URL:', CONFIG.FRONTEND_URL);
    }
}