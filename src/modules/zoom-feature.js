/**
 * Zoom Feature Module
 * Handles interactive zoom window with radar data detail view
 */

import { getMap } from './map-manager.js';
import { generateZoomRadarData, valueToRainbowColor } from './radar-display.js';

// Zoom feature state
let hoverRectangle = null;
let hoverRay = null;
let isMouseOverRadar = false;
let currentHoverLatLng = null;
let zoomWindowActive = false;
let zoomMap = null;
let zoomListeners = null;
let wheelHandlerRef = null;

// Zoom levels: 10 increments from 0.1° to 0.5° (in degrees lat/lng)
const ZOOM_LEVELS = [0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5, 0.55];
let currentZoomLevelIndex = 0; // Start at 0.1°

const ZOOM_CONFIG = {
    CANVAS_SIZE: 330
};

/**
 * Calculate distance and bearing
 */
function calculateDistanceAndBearing(center, target) {
    // Validate inputs
    if (!center || !target ||
        typeof center.lat !== 'number' || typeof center.lng !== 'number' ||
        typeof target.lat !== 'number' || typeof target.lng !== 'number') {
        console.error('Invalid coordinates for distance calculation:', { center, target });
        return { distance: 0, bearing: 0 };
    }

    const R = 6371000;
    const lat1 = center.lat * Math.PI / 180;
    const lng1 = center.lng * Math.PI / 180;
    const lat2 = target.lat * Math.PI / 180;
    const lng2 = target.lng * Math.PI / 180;

    const dLat = lat2 - lat1;
    const dLng = lng2 - lng1;

    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1) * Math.cos(lat2) *
              Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const distance = R * c;

    const y = Math.sin(dLng) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) -
              Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
    let bearing = Math.atan2(y, x) * 180 / Math.PI;
    bearing = (bearing + 360) % 360;

    return { distance, bearing };
}

/**
 * Calculate destination point
 */
function calculateDestinationPoint(center, distance, bearing) {
    const R = 6371000;
    const lat1 = center.lat * Math.PI / 180;
    const lng1 = center.lng * Math.PI / 180;
    const bearingRad = bearing * Math.PI / 180;

    const lat2 = Math.asin(
        Math.sin(lat1) * Math.cos(distance / R) +
        Math.cos(lat1) * Math.sin(distance / R) * Math.cos(bearingRad)
    );

    const lng2 = lng1 + Math.atan2(
        Math.sin(bearingRad) * Math.sin(distance / R) * Math.cos(lat1),
        Math.cos(distance / R) - Math.sin(lat1) * Math.sin(lat2)
    );

    return {
        lat: lat2 * 180 / Math.PI,
        lng: lng2 * 180 / Math.PI
    };
}

/**
 * Check if point is inside radar circle
 */
function isInsideRadarCircle(latLng, radarCenter, maxRange) {
    const { distance } = calculateDistanceAndBearing(radarCenter, latLng);
    return distance <= maxRange;
}

/**
 * Enable zoom feature
 */
export function enableZoomFeature(radarData) {
    if (!radarData || zoomWindowActive) return;

    zoomWindowActive = true;
    const radarCenter = { lat: radarData.site.lat, lng: radarData.site.lon };
    const maxRange = radarData.maxRange;
    const map = getMap();

    // Reset to default zoom level
    currentZoomLevelIndex = 0;

    console.log(`Initial zoom level: ±${ZOOM_LEVELS[currentZoomLevelIndex]}° lat/lng`);

    // Add mouse move listener
    const mouseMoveListener = map.addListener('mousemove', (event) => {
        const latLng = { lat: event.latLng.lat(), lng: event.latLng.lng() };

        if (isInsideRadarCircle(latLng, radarCenter, maxRange)) {
            if (!isMouseOverRadar) {
                isMouseOverRadar = true;
                document.getElementById('zoomWindow').style.display = 'block';
            }
            currentHoverLatLng = latLng;
            updateHoverIndicators(latLng, radarCenter, radarData);
            updateZoomWindow(latLng, radarData);
        } else {
            if (isMouseOverRadar) {
                isMouseOverRadar = false;
                clearHoverIndicators();
                document.getElementById('zoomWindow').style.display = 'none';
            }
        }
    });

    // Add wheel listener for zoom control
    const wheelHandler = (event) => {
        if (!isMouseOverRadar) return;

        event.preventDefault();
        event.stopPropagation();

        const delta = event.deltaY;
        const oldIndex = currentZoomLevelIndex;

        if (delta < 0) {
            // Scroll up - zoom in (smaller degrees = more zoomed in)
            currentZoomLevelIndex = Math.max(0, currentZoomLevelIndex - 1);
        } else {
            // Scroll down - zoom out (larger degrees = more zoomed out)
            currentZoomLevelIndex = Math.min(ZOOM_LEVELS.length - 1, currentZoomLevelIndex + 1);
        }

        if (oldIndex !== currentZoomLevelIndex) {
            console.log(`Zoom: ±${ZOOM_LEVELS[oldIndex]}° -> ±${ZOOM_LEVELS[currentZoomLevelIndex]}°`);

            if (currentHoverLatLng) {
                updateHoverIndicators(currentHoverLatLng, radarCenter, radarData);
                updateZoomWindow(currentHoverLatLng, radarData);
            }
        }
    };

    const mapDiv = map.getDiv();
    mapDiv.addEventListener('wheel', wheelHandler, { passive: false });
    wheelHandlerRef = wheelHandler;

    zoomListeners = [mouseMoveListener];
}

/**
 * Disable zoom feature
 */
export function disableZoomFeature() {
    zoomWindowActive = false;
    isMouseOverRadar = false;
    currentHoverLatLng = null;

    clearHoverIndicators();
    document.getElementById('zoomWindow').style.display = 'none';

    if (zoomListeners) {
        zoomListeners.forEach(listener => google.maps.event.removeListener(listener));
        zoomListeners = null;
    }

    if (wheelHandlerRef) {
        const map = getMap();
        const mapDiv = map.getDiv();
        mapDiv.removeEventListener('wheel', wheelHandlerRef);
        wheelHandlerRef = null;
    }
}

/**
 * Update hover indicators (rectangle and ray)
 */
function updateHoverIndicators(latLng, radarCenter, radarData) {
    if (!latLng || !radarCenter) return;

    const map = getMap();
    if (!map) return;

    // Get current zoom level offset
    const offset = ZOOM_LEVELS[currentZoomLevelIndex];

    // Create rectangle bounds centered on hover point
    const bounds = {
        north: latLng.lat + offset,
        south: latLng.lat - offset,
        east: latLng.lng + offset,
        west: latLng.lng - offset
    };

    // Update or create rectangle
    if (hoverRectangle) {
        hoverRectangle.setBounds(bounds);
    } else {
        hoverRectangle = new google.maps.Rectangle({
            bounds: bounds,
            strokeColor: '#000000',
            strokeOpacity: 0.8,
            strokeWeight: 2,
            fillColor: '#000000',
            fillOpacity: 0.1,
            map: map,
            clickable: false,
            zIndex: 3
        });
    }

    // Update ray from radar center through hover point to radar edge
    const { bearing: azimuth } = calculateDistanceAndBearing(radarCenter, latLng);

    // Get actual radar max range
    const maxRange = radarData ? radarData.maxRange : 230000;

    // Calculate point at radar edge using actual max range
    const radarEdgePoint = calculateDestinationPoint(radarCenter, maxRange, azimuth);

    if (hoverRay) {
        hoverRay.setPath([radarCenter, radarEdgePoint]);
        hoverRay.setOptions({ strokeColor: '#000000' });
    } else {
        hoverRay = new google.maps.Polyline({
            path: [radarCenter, radarEdgePoint],
            strokeColor: '#000000',
            strokeOpacity: 0.7,
            strokeWeight: 2,
            map: map,
            clickable: false,
            zIndex: 2
        });
    }
}

/**
 * Clear hover indicators
 */
function clearHoverIndicators() {
    if (hoverRectangle) {
        hoverRectangle.setMap(null);
        hoverRectangle = null;
    }
    if (hoverRay) {
        hoverRay.setMap(null);
        hoverRay = null;
    }
}

/**
 * Initialize zoom map
 */
function initializeZoomMap() {
    if (zoomMap) return;

    const zoomMapDiv = document.getElementById('zoomMap');
    if (!zoomMapDiv) return;

    zoomMap = new google.maps.Map(zoomMapDiv, {
        zoom: 15,
        center: { lat: 0, lng: 0 },
        mapTypeId: google.maps.MapTypeId.TERRAIN,
        disableDefaultUI: true,
        gestureHandling: 'none',
        zoomControl: false,
        mapTypeControl: false,
        scaleControl: false,
        streetViewControl: false,
        rotateControl: false,
        fullscreenControl: false
    });
}

/**
 * Update zoom window
 */
function updateZoomWindow(latLng, radarData) {
    if (!radarData || !latLng || !hoverRectangle) return;

    if (!zoomMap) {
        initializeZoomMap();
    }

    const radarCenter = { lat: radarData.site.lat, lng: radarData.site.lon };
    const { bearing: azimuth, distance: range } = calculateDistanceAndBearing(radarCenter, latLng);

    const coordsDiv = document.getElementById('zoomCoords');
    if (!coordsDiv) return;

    // Get current zoom offset
    const offset = ZOOM_LEVELS[currentZoomLevelIndex];

    // Update coordinates display
    coordsDiv.textContent = `${latLng.lat.toFixed(4)}°, ${latLng.lng.toFixed(4)}° | ${(range / 1000).toFixed(1)} km | Az: ${azimuth.toFixed(1)}° | Zoom: ±${offset}°`;

    // Fit zoom map to rectangle bounds
    const bounds = hoverRectangle.getBounds();
    zoomMap.fitBounds(bounds);

    // Draw overlay on canvas
    drawRadarOverlay(offset);
}

/**
 * Draw radar data on zoom canvas (DISABLED - just shows basic overlay)
 */
function drawRadarOverlay(offset) {
    const canvas = document.getElementById('zoomCanvas');
    if (!canvas) return;

    const canvasSize = ZOOM_CONFIG.CANVAS_SIZE;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = canvasSize * dpr;
    canvas.height = canvasSize * dpr;
    canvas.style.width = canvasSize + 'px';
    canvas.style.height = canvasSize + 'px';

    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, canvasSize, canvasSize);

    // RADAR HEATMAP RENDERING DISABLED
    // Just show crosshair and info overlay without the heavy radar data rendering

    ctx.globalAlpha = 1.0;

    // Draw crosshair at center
    ctx.strokeStyle = 'rgba(136, 136, 136, 0.8)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(canvasSize / 2 - 10, canvasSize / 2);
    ctx.lineTo(canvasSize / 2 + 10, canvasSize / 2);
    ctx.moveTo(canvasSize / 2, canvasSize / 2 - 10);
    ctx.lineTo(canvasSize / 2, canvasSize / 2 + 10);
    ctx.stroke();

    // Draw info overlay
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.fillRect(0, 0, canvasSize, 40);

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 12px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(`Zoom Level: ±${offset}° lat/lng`, canvasSize / 2, 15);

    ctx.font = '11px Arial';
    const latDegrees = offset * 2;
    const kmApprox = latDegrees * 111; // Rough approximation: 1° ≈ 111km
    ctx.fillText(`Coverage: ~${kmApprox.toFixed(1)} km`, canvasSize / 2, 30);
}
