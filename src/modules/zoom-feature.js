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

// Zoom levels: 12 increments from 0.025° to 0.55° (in degrees lat/lng)
const ZOOM_LEVELS = [0.025, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5, 0.55];
let currentZoomLevelIndex = 2; // Start at 0.1°

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
    currentZoomLevelIndex = 2;

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

    // Add wheel listener - prevents map zoom and controls rectangle size
    const wheelHandler = (event) => {
        // Always prevent default map zoom behavior when radar is loaded
        event.preventDefault();
        event.stopPropagation();

        // Only adjust rectangle zoom if mouse is over radar area
        if (!isMouseOverRadar) return;

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

    // Disable map zoom controls
    map.setOptions({
        scrollwheel: false,
        gestureHandling: 'greedy'
    });

    console.log('Map zoom disabled - scroll wheel now controls rectangle size only');

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

        // Re-enable map zoom controls
        map.setOptions({
            scrollwheel: true,
            gestureHandling: 'greedy'
        });

        console.log('Map zoom re-enabled');
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

    // Draw overlay on canvas with radar data
    drawRadarOverlay(offset, radarData, latLng.lat, latLng.lng);
}

/**
 * Convert geographic coordinates to canvas coordinates relative to zoom window
 */
function geoToCanvas(lat, lng, centerLat, centerLng, offset, canvasSize) {
    // Calculate position relative to center in degrees
    const deltaLat = lat - centerLat;
    const deltaLng = lng - centerLng;

    // Normalize to -1 to 1 range based on offset
    const normalizedX = deltaLng / offset;
    const normalizedY = -deltaLat / offset; // Negative because canvas Y increases downward

    // Map to canvas coordinates
    const x = (normalizedX * 0.5 + 0.5) * canvasSize;
    const y = (normalizedY * 0.5 + 0.5) * canvasSize;

    return { x, y };
}

/**
 * Calculate geographic point from radar center given distance and bearing
 */
function radarPolarToGeo(radarCenter, range, azimuth) {
    const R = 6371000; // Earth radius in meters
    const lat1 = radarCenter.lat * Math.PI / 180;
    const lng1 = radarCenter.lng * Math.PI / 180;
    const bearingRad = azimuth * Math.PI / 180;

    const lat2 = Math.asin(
        Math.sin(lat1) * Math.cos(range / R) +
        Math.cos(lat1) * Math.sin(range / R) * Math.cos(bearingRad)
    );

    const lng2 = lng1 + Math.atan2(
        Math.sin(bearingRad) * Math.sin(range / R) * Math.cos(lat1),
        Math.cos(range / R) - Math.sin(lat1) * Math.sin(lat2)
    );

    return {
        lat: lat2 * 180 / Math.PI,
        lng: lng2 * 180 / Math.PI
    };
}

/**
 * Draw a radial segment (wedge) on canvas
 */
function drawRadialSegment(ctx, radarCenter, centerLat, centerLng, offset, canvasSize, innerRange, outerRange, startAzimuth, endAzimuth, color, hasValue) {
    // Calculate the 4 corners of the segment
    const innerStart = radarPolarToGeo(radarCenter, innerRange, startAzimuth);
    const innerEnd = radarPolarToGeo(radarCenter, innerRange, endAzimuth);
    const outerStart = radarPolarToGeo(radarCenter, outerRange, startAzimuth);
    const outerEnd = radarPolarToGeo(radarCenter, outerRange, endAzimuth);

    // Convert to canvas coordinates
    const p1 = geoToCanvas(innerStart.lat, innerStart.lng, centerLat, centerLng, offset, canvasSize);
    const p2 = geoToCanvas(innerEnd.lat, innerEnd.lng, centerLat, centerLng, offset, canvasSize);
    const p3 = geoToCanvas(outerEnd.lat, outerEnd.lng, centerLat, centerLng, offset, canvasSize);
    const p4 = geoToCanvas(outerStart.lat, outerStart.lng, centerLat, centerLng, offset, canvasSize);

    // Check if any point is within canvas bounds (with margin)
    const margin = canvasSize * 0.1;
    const isVisible = [p1, p2, p3, p4].some(p =>
        p.x >= -margin && p.x <= canvasSize + margin &&
        p.y >= -margin && p.y <= canvasSize + margin
    );

    if (!isVisible) return;

    // Draw the quadrilateral
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.lineTo(p3.x, p3.y);
    ctx.lineTo(p4.x, p4.y);
    ctx.closePath();

    // Fill with color if it has a value
    if (hasValue) {
        ctx.fillStyle = color;
        ctx.fill();
    }

    // Draw thin gray border
    ctx.strokeStyle = 'rgba(128, 128, 128, 0.3)';
    ctx.lineWidth = 0.5;
    ctx.stroke();
}

/**
 * Draw radar data on zoom canvas with radial segments
 */
function drawRadarOverlay(offset, radarData, centerLat, centerLng) {
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

    // Draw radar data if available
    if (radarData) {
        const radarCenter = { lat: radarData.site.lat, lng: radarData.site.lon };
        const zoomRadarData = generateZoomRadarData(radarData, { lat: centerLat, lng: centerLng }, radarCenter, offset);

        if (zoomRadarData) {
            const { azimuths, ranges, reflectivity, nrays, ngates, minVal, maxVal } = zoomRadarData;

            // Draw each radial segment
            for (let rayIdx = 0; rayIdx < nrays; rayIdx++) {
                const azimuth = azimuths[rayIdx];

                // Calculate angular width between rays
                const nextRayIdx = (rayIdx + 1) % nrays;
                const nextAzimuth = azimuths[nextRayIdx];
                let angularWidth = nextAzimuth - azimuth;

                // Handle wrap-around at 360°
                if (angularWidth < 0) {
                    angularWidth += 360;
                }
                if (angularWidth > 180) {
                    angularWidth = 360 / nrays; // Fallback to average
                }

                const startAzimuth = azimuth - angularWidth / 2;
                const endAzimuth = azimuth + angularWidth / 2;

                // Draw each gate along this ray
                for (let gateIdx = 0; gateIdx < ngates; gateIdx++) {
                    const value = reflectivity[rayIdx][gateIdx];

                    // Check if value is valid
                    const hasValue = value !== null && value !== undefined && !isNaN(value);

                    // Get color if value exists
                    let color = null;
                    if (hasValue) {
                        const normalized = (value - minVal) / (maxVal - minVal);
                        color = valueToRainbowColor(normalized);
                    }

                    // Get range boundaries
                    const innerRange = ranges[gateIdx];
                    const outerRange = gateIdx < ngates - 1 ? ranges[gateIdx + 1] : innerRange + (innerRange - (gateIdx > 0 ? ranges[gateIdx - 1] : 0));

                    // Draw the segment (both filled and empty segments get borders)
                    drawRadialSegment(
                        ctx,
                        radarCenter,
                        centerLat,
                        centerLng,
                        offset,
                        canvasSize,
                        innerRange,
                        outerRange,
                        startAzimuth,
                        endAzimuth,
                        color,
                        hasValue
                    );
                }
            }
        }
    }

    ctx.globalAlpha = 1.0;

    // Draw crosshair at center
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.lineWidth = 2;
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
