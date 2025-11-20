/**
 * Application state management
 */

// Global application state
const state = {
    // Map and markers
    map: null,
    markers: [],
    infoWindow: null,

    // Selection state
    selectedSite: null,
    selectedDate: null,
    selectedTime: null,
    availableSites: null,

    // Radar visualization
    rangeRings: [],
    crosshairLines: [],
    radarOverlay: null,
    loadingMarker: null,
    currentScanIndex: null,

    // Zoom feature
    zoomLevel: 4,
    hoverSquare: null,
    hoverRay: null,
    isMouseOverRadar: false,
    currentHoverLatLng: null,
    zoomWindowActive: false,
    zoomMap: null,
    zoomListeners: null,
    wheelHandlerRef: null,

    // Radar data
    radarFileData: null,
    currentRadarFile: null
};

/**
 * Get state value
 */
export function getState(key) {
    return state[key];
}

/**
 * Set state value
 */
export function setState(key, value) {
    state[key] = value;
}

/**
 * Get multiple state values
 */
export function getStates(...keys) {
    const result = {};
    keys.forEach(key => {
        result[key] = state[key];
    });
    return result;
}

/**
 * Update multiple state values
 */
export function setStates(updates) {
    Object.keys(updates).forEach(key => {
        state[key] = updates[key];
    });
}

/**
 * Reset all state to initial values
 */
export function resetState() {
    state.selectedSite = null;
    state.selectedDate = null;
    state.selectedTime = null;
    state.availableSites = null;
    state.rangeRings = [];
    state.crosshairLines = [];
    state.radarOverlay = null;
    state.loadingMarker = null;
    state.currentScanIndex = null;
    state.zoomLevel = 4;
    state.hoverSquare = null;
    state.hoverRay = null;
    state.isMouseOverRadar = false;
    state.currentHoverLatLng = null;
    state.zoomWindowActive = false;
    state.radarFileData = null;
    state.currentRadarFile = null;
}

// Make radar data globally accessible for compatibility
if (typeof window !== 'undefined') {
    Object.defineProperty(window, 'radarFileData', {
        get: () => state.radarFileData,
        set: (value) => { state.radarFileData = value; }
    });

    Object.defineProperty(window, 'currentRadarFile', {
        get: () => state.currentRadarFile,
        set: (value) => { state.currentRadarFile = value; }
    });

    Object.defineProperty(window, 'currentScanIndex', {
        get: () => state.currentScanIndex,
        set: (value) => { state.currentScanIndex = value; }
    });
}
