/**
 * Application constants and configuration
 */

export const S3_CONFIG = {
    BASE_URL: 'https://s3.amazonaws.com/unidata-nexrad-level2',
    BUCKET: 'unidata-nexrad-level2',
    REGION: 'us-east-1'
};

export const MAP_CONFIG = {
    DEFAULT_CENTER: { lat: 39.8283, lng: -98.5795 },
    DEFAULT_ZOOM: 4,
    RADAR_ZOOM: 8,
    MAP_ID: 'DEMO_MAP_ID'
};

export const RADAR_CONFIG = {
    MAX_RANGE: 230000, // 230km in meters
    NUM_RANGE_RINGS: 5,
    CANVAS_SIZE: 2048,
    ZOOM_CANVAS_SIZE: 330,
    HEATMAP_OPACITY: 0.7,
    RADAR_DATA_OPACITY: 0.95
};

export const ZOOM_CONFIG = {
    LEVELS: [1, 2, 4, 8, 16, 32, 64],
    DEFAULT_LEVEL: 4,
    MIN_LEVEL: 1,
    MAX_LEVEL: 64
};

export const UI_CONFIG = {
    REQUEST_TIMEOUT: 30000, // 30 seconds
    YEAR_RANGE_START: 1991
};

export const COLORS = {
    MARKER_AVAILABLE: '#D4A017',   // Ochre yellow
    MARKER_SELECTED: '#16A34A',     // Green
    MARKER_UNAVAILABLE: '#DC2626',  // Red
    CROSSHAIR: '#666666',
    HOVER_INDICATOR: '#888888'
};

export const PROXY_METHODS = [
    {
        name: 'Iowa Hydroinformatics',
        getUrl: (s3Url) => `https://hydroinformatics.uiowa.edu/lab/cors/${encodeURIComponent(s3Url)}`
    },
    {
        name: 'allorigins',
        getUrl: (s3Url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(s3Url)}`
    },
    {
        name: 'corsproxy.io',
        getUrl: (s3Url) => `https://corsproxy.io/?${encodeURIComponent(s3Url)}`
    },
    {
        name: 'proxy.cors.sh',
        getUrl: (s3Url) => `https://proxy.cors.sh/${s3Url}`
    },
    {
        name: 'direct',
        getUrl: (s3Url) => s3Url
    }
];
