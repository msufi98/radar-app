/**
 * Zoom Feature Module
 * Handles interactive zoom window with radar data detail view
 */

import { getMap } from './map-manager.js';
import { generateZoomRadarData, valueToRainbowColor } from './radar-display.js';
import { updateCrossSection } from './cross-section.js';

// Zoom feature state
let hoverRectangle = null;
let hoverRay = null;
let hoverArc = null;
let isMouseOverRadar = false;
let isDragging = false;
let currentHoverLatLng = null;
let zoomWindowActive = false;
let zoomMap = null;
let zoomListeners = null;
let wheelHandlerRef = null;
let canvasRedrawTimeout = null;
let lastCanvasRedrawTime = 0;
let lastIndicatorUpdateTime = 0;
let effectiveMaxRange = null;
let zoomButtonListeners = null;
let currentRadarData = null;

// Zoom levels: 5 levels from 0.025° to 0.55° (in degrees lat/lng)
const ZOOM_LEVELS = [0.025, 0.15, 0.3, 0.425, 0.55];
let currentZoomLevelIndex = 0; // Start at 0.025° (highest zoom level)

const ZOOM_CONFIG = {
    CANVAS_SIZE: 330,
    DEBOUNCE_MS: 150, // Wait for mouse to stop before redrawing (was 20ms)
    INDICATOR_THROTTLE_MS: 16 // ~60fps throttle for hover indicators
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
 * Update zoom button states based on current zoom level
 */
function updateZoomButtonStates() {
    const zoomInBtn = document.getElementById('zoomInBtn');
    const zoomOutBtn = document.getElementById('zoomOutBtn');

    if (zoomInBtn) {
        zoomInBtn.disabled = (currentZoomLevelIndex === 0);
    }
    if (zoomOutBtn) {
        zoomOutBtn.disabled = (currentZoomLevelIndex === ZOOM_LEVELS.length - 1);
    }
}

/**
 * Handle zoom button click
 */
function handleZoomButtonClick(zoomIn) {
    if (!currentHoverLatLng || !currentRadarData) return;

    const radarCenter = { lat: currentRadarData.site.lat, lng: currentRadarData.site.lon };
    const oldIndex = currentZoomLevelIndex;

    if (zoomIn) {
        // Zoom in (smaller degrees = more zoomed in)
        currentZoomLevelIndex = Math.max(0, currentZoomLevelIndex - 1);
    } else {
        // Zoom out (larger degrees = more zoomed out)
        currentZoomLevelIndex = Math.min(ZOOM_LEVELS.length - 1, currentZoomLevelIndex + 1);
    }

    if (oldIndex !== currentZoomLevelIndex) {
        console.log(`Zoom: ±${ZOOM_LEVELS[oldIndex]}° -> ±${ZOOM_LEVELS[currentZoomLevelIndex]}°`);

        // Update indicators and zoom window
        updateHoverIndicators(currentHoverLatLng, radarCenter, currentRadarData, true);
        updateZoomWindow(currentHoverLatLng, currentRadarData, false);
        updateZoomButtonStates();
    }
}

/**
 * Enable zoom feature
 */
export function enableZoomFeature(radarData, effectiveRange = null) {
    if (!radarData) return;

    const maxRange = effectiveRange || radarData.maxRange;

    // If already active, just update the effective range and radar data
    if (zoomWindowActive) {
        effectiveMaxRange = maxRange;
        currentRadarData = radarData;
        console.log(`Updated effective max range: ${(effectiveMaxRange / 1000).toFixed(1)} km`);

        // Update hover indicators if we have a current position
        if (currentHoverLatLng) {
            const radarCenter = { lat: radarData.site.lat, lng: radarData.site.lon };
            updateHoverIndicators(currentHoverLatLng, radarCenter, radarData, true);
        }
        return;
    }

    zoomWindowActive = true;
    currentRadarData = radarData;
    const radarCenter = { lat: radarData.site.lat, lng: radarData.site.lon };
    effectiveMaxRange = maxRange; // Store for later use
    const map = getMap();

    // Reset to default zoom level
    currentZoomLevelIndex = 0;
    updateZoomButtonStates();

    console.log(`Initial zoom level: ±${ZOOM_LEVELS[currentZoomLevelIndex]}° lat/lng`);

    // Add mouse down listener - start dragging
    const mouseDownListener = map.addListener('mousedown', (event) => {
        const latLng = { lat: event.latLng.lat(), lng: event.latLng.lng() };

        if (isInsideRadarCircle(latLng, radarCenter, maxRange)) {
            isDragging = true;
            isMouseOverRadar = true;
            const zoomWindow = document.getElementById('zoomWindow');
            zoomWindow.style.display = 'block';
            // Add dragging class to gray out the detail view
            zoomWindow.classList.add('dragging');
            currentHoverLatLng = latLng;
            // Update indicators and cross-section immediately on click
            updateHoverIndicators(latLng, radarCenter, radarData, true);
            const { bearing: azimuth, distance: range } = calculateDistanceAndBearing(radarCenter, latLng);
            updateCrossSection(radarData, azimuth, range);
        }
    });

    // Add mouse move listener - update indicators and cross-section when dragging
    const mouseMoveListener = map.addListener('mousemove', (event) => {
        if (!isDragging) return;

        const latLng = { lat: event.latLng.lat(), lng: event.latLng.lng() };

        if (isInsideRadarCircle(latLng, radarCenter, maxRange)) {
            currentHoverLatLng = latLng;
            // Update visual indicators (box and ray) in real-time - no throttling
            updateHoverIndicators(latLng, radarCenter, radarData, true);
            // Update cross-section during drag in real-time
            const { bearing: azimuth, distance: range } = calculateDistanceAndBearing(radarCenter, latLng);
            updateCrossSection(radarData, azimuth, range);
        }
    });

    // Add mouse up listener - stop dragging and update zoom window
    const mouseUpListener = map.addListener('mouseup', () => {
        if (isDragging) {
            isDragging = false;
            // Remove dragging class
            const zoomWindow = document.getElementById('zoomWindow');
            if (zoomWindow) {
                zoomWindow.classList.remove('dragging');
            }

            // Now update zoom window after drag is complete
            if (currentHoverLatLng) {
                updateZoomWindow(currentHoverLatLng, radarData, true); // Force immediate update
            }
        }
    });

    // Add wheel listener - prevents map zoom and controls rectangle size
    const wheelHandler = (event) => {
        // Always prevent default map zoom behavior when radar is loaded
        event.preventDefault();
        event.stopPropagation();

        // Only adjust rectangle zoom if we have a position set
        if (!currentHoverLatLng) return;

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
                // Update indicators immediately, but debounce zoom window redraw
                updateHoverIndicators(currentHoverLatLng, radarCenter, radarData, true);
                updateZoomWindow(currentHoverLatLng, radarData, false); // Changed to false for debounced redraw
                updateZoomButtonStates();
            }
        }
    };

    const mapDiv = map.getDiv();
    mapDiv.addEventListener('wheel', wheelHandler, { passive: false });
    wheelHandlerRef = wheelHandler;

    // Add zoom button listeners
    const zoomInBtn = document.getElementById('zoomInBtn');
    const zoomOutBtn = document.getElementById('zoomOutBtn');

    const zoomInHandler = () => handleZoomButtonClick(true);
    const zoomOutHandler = () => handleZoomButtonClick(false);

    if (zoomInBtn) {
        zoomInBtn.addEventListener('click', zoomInHandler);
    }
    if (zoomOutBtn) {
        zoomOutBtn.addEventListener('click', zoomOutHandler);
    }

    zoomButtonListeners = { zoomInBtn, zoomOutBtn, zoomInHandler, zoomOutHandler };

    // Disable map zoom controls
    map.setOptions({
        scrollwheel: false,
        gestureHandling: 'greedy'
    });

    console.log('Map zoom disabled - scroll wheel now controls rectangle size only');

    zoomListeners = [mouseDownListener, mouseMoveListener, mouseUpListener];
}

/**
 * Disable zoom feature
 */
export function disableZoomFeature() {
    zoomWindowActive = false;
    isMouseOverRadar = false;
    isDragging = false;
    currentHoverLatLng = null;
    effectiveMaxRange = null;
    currentRadarData = null;

    // Clear any pending canvas redraw
    if (canvasRedrawTimeout) {
        clearTimeout(canvasRedrawTimeout);
        canvasRedrawTimeout = null;
    }

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

    // Remove zoom button listeners
    if (zoomButtonListeners) {
        const { zoomInBtn, zoomOutBtn, zoomInHandler, zoomOutHandler } = zoomButtonListeners;
        if (zoomInBtn) {
            zoomInBtn.removeEventListener('click', zoomInHandler);
        }
        if (zoomOutBtn) {
            zoomOutBtn.removeEventListener('click', zoomOutHandler);
        }
        zoomButtonListeners = null;
    }
}

/**
 * Update hover indicators (rectangle and ray) with throttling
 */
function updateHoverIndicators(latLng, radarCenter, radarData, forceImmediate = false) {
    if (!latLng || !radarCenter) return;

    // Throttle indicator updates to ~60fps unless forced (follows Google Maps performance guidelines)
    const now = Date.now();
    if (!forceImmediate && now - lastIndicatorUpdateTime < ZOOM_CONFIG.INDICATOR_THROTTLE_MS) {
        return;
    }
    lastIndicatorUpdateTime = now;

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

    // Get effective radar max range
    const maxRange = effectiveMaxRange || (radarData ? radarData.maxRange : 230000);

    // Calculate point at radar edge using effective max range
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

    // Update arc showing ±15° viewing area
    const { distance: range } = calculateDistanceAndBearing(radarCenter, latLng);
    const arcPoints = generateArcPoints(radarCenter, range, azimuth, 15, 21);

    if (hoverArc) {
        hoverArc.setPath(arcPoints);
    } else {
        hoverArc = new google.maps.Polyline({
            path: arcPoints,
            strokeColor: '#000000',
            strokeOpacity: 0.6,
            strokeWeight: 2,
            map: map,
            clickable: false,
            zIndex: 2
        });
    }
}

/**
 * Generate points for an arc centered at a given azimuth
 * @param {Object} center - Center point {lat, lng}
 * @param {number} radius - Radius in meters
 * @param {number} centerAzimuth - Center azimuth in degrees
 * @param {number} halfWidth - Half-width of arc in degrees
 * @param {number} numArcPoints - Number of points on the arc
 * @returns {Array} Array of {lat, lng} points
 */
function generateArcPoints(center, radius, centerAzimuth, halfWidth, numArcPoints) {
    const points = [];
    const startAzimuth = centerAzimuth - halfWidth;
    const endAzimuth = centerAzimuth + halfWidth;
    const step = (endAzimuth - startAzimuth) / (numArcPoints - 1);

    // Generate arc points only (no lines to/from center)
    for (let i = 0; i < numArcPoints; i++) {
        let azimuth = startAzimuth + i * step;
        // Normalize azimuth to 0-360
        if (azimuth < 0) azimuth += 360;
        if (azimuth >= 360) azimuth -= 360;

        const point = calculateDestinationPoint(center, radius, azimuth);
        points.push(point);
    }

    return points;
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
    if (hoverArc) {
        hoverArc.setMap(null);
        hoverArc = null;
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
 * Update zoom window (debounced for performance)
 */
function updateZoomWindow(latLng, radarData, forceImmediate = false) {
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

    // Update coordinates display (lightweight operation - do immediately)
    coordsDiv.textContent = `${latLng.lat.toFixed(4)}°, ${latLng.lng.toFixed(4)}° | ${(range / 1000).toFixed(1)} km | Zoom: ±${offset}°`;

    // Update zoom map bounds (lightweight operation - do immediately)
    const bounds = hoverRectangle.getBounds();
    zoomMap.fitBounds(bounds);

    // Get loading overlay element
    const loadingOverlay = document.getElementById('zoomLoadingOverlay');

    // Debounce expensive canvas redraw to avoid lag during mouse movement
    // This follows Google Maps guidelines to avoid drawing overlays while map is moving
    if (canvasRedrawTimeout) {
        clearTimeout(canvasRedrawTimeout);
    }

    if (forceImmediate) {
        // Force immediate redraw (used for wheel zoom changes)
        if (loadingOverlay) loadingOverlay.style.display = 'none';
        drawRadarOverlay(offset, radarData, latLng.lat, latLng.lng);
        lastCanvasRedrawTime = Date.now();
    } else {
        // Show loading overlay while waiting for debounced redraw
        if (loadingOverlay) loadingOverlay.style.display = 'block';

        // Debounce canvas redraw during mouse movement
        canvasRedrawTimeout = setTimeout(() => {
            drawRadarOverlay(offset, radarData, latLng.lat, latLng.lng);
            lastCanvasRedrawTime = Date.now();
            canvasRedrawTimeout = null;

            // Hide loading overlay after redraw completes
            if (loadingOverlay) loadingOverlay.style.display = 'none';
        }, ZOOM_CONFIG.DEBOUNCE_MS);
    }
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
    ctx.strokeStyle = 'rgba(100, 100, 100, 0.25)';
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
                    const gateRange = ranges[gateIdx];

                    // Skip gates beyond effective range
                    if (effectiveMaxRange && gateRange > effectiveMaxRange) {
                        break; // No need to render further gates on this ray
                    }

                    const value = reflectivity[rayIdx][gateIdx];

                    // Check if value is valid
                    const hasValue = value !== null && value !== undefined && !isNaN(value);

                    // Get color if value exists (using actual dBZ value)
                    let color = null;
                    if (hasValue) {
                        color = valueToRainbowColor(value);
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
    // ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    // ctx.fillRect(0, 0, canvasSize, 40);

    // ctx.fillStyle = '#ffffff';
    // ctx.font = 'bold 12px Arial';
    // ctx.textAlign = 'center';
    // ctx.fillText(`Zoom Level: ±${offset}° lat/lng`, canvasSize / 2, 15);

    // ctx.font = '11px Arial';
    // const latDegrees = offset * 2;
    // const kmApprox = latDegrees * 111; // Rough approximation: 1° ≈ 111km
    // ctx.fillText(`Coverage: ~${kmApprox.toFixed(1)} km`, canvasSize / 2, 30);
}
