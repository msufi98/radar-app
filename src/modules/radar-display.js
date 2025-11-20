/**
 * Radar Display Module
 * Handles radar data visualization, heatmap generation, and legend
 */

import { getMap, setRadarOverlay } from './map-manager.js';

// Radar display state
let currentScanIndex = null;
let minReflectivity = null;
let maxReflectivity = null;

const RADAR_CONFIG = {
    CANVAS_SIZE: 2048,
    HEATMAP_OPACITY: 0.7,
    DATA_OPACITY: 0.95
};

/**
 * Map a value to rainbow color (violet to red)
 */
function valueToRainbowColor(value) {
    value = Math.max(0, Math.min(1, value));
    const hue = (1 - value) * 270;

    const h = hue / 360;
    const s = 1.0;
    const l = 0.5;

    let r, g, b;

    if (s === 0) {
        r = g = b = l;
    } else {
        const hue2rgb = (p, q, t) => {
            if (t < 0) t += 1;
            if (t > 1) t -= 1;
            if (t < 1/6) return p + (q - p) * 6 * t;
            if (t < 1/2) return q;
            if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
            return p;
        };

        const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        const p = 2 * l - q;

        r = hue2rgb(p, q, h + 1/3);
        g = hue2rgb(p, q, h);
        b = hue2rgb(p, q, h - 1/3);
    }

    return `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`;
}

/**
 * Calculate destination point from center, distance, and bearing
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
 * Generate and display radar heatmap
 */
export async function displayRadarHeatmap(radarData, scanIndex) {
    if (!radarData || !radarData.nexradFile) {
        console.error('No radar data available');
        return null;
    }

    currentScanIndex = scanIndex;
    window.currentScanIndex = scanIndex; // For zoom feature

    const nexradFile = radarData.nexradFile;
    const center = { lat: radarData.site.lat, lng: radarData.site.lon };

    // Get scan info
    const scanInfo = nexradFile.scan_info([scanIndex])[0];
    if (!scanInfo.moments.includes('REF')) {
        throw new Error('No reflectivity data available for this scan');
    }

    // Get data arrays
    const ngates = scanInfo.ngates.REF;
    const nrays = scanInfo.nrays;
    const azimuths = nexradFile.get_azimuth_angles([scanIndex]);
    const ranges = nexradFile.get_range(scanIndex, 'REF');
    const refData = nexradFile.get_data('REF', ngates, [scanIndex], false);

    console.log(`Generating heatmap: ${nrays} rays × ${ngates} gates`);

    // Find min/max values for color scaling
    let minVal = Infinity;
    let maxVal = -Infinity;
    for (let ray = 0; ray < nrays; ray++) {
        for (let gate = 0; gate < ngates; gate++) {
            const val = refData[ray][gate];
            if (val !== null && val !== undefined && !isNaN(val)) {
                minVal = Math.min(minVal, val);
                maxVal = Math.max(maxVal, val);
            }
        }
    }

    minReflectivity = minVal;
    maxReflectivity = maxVal;

    console.log(`Reflectivity range: ${minVal.toFixed(1)} to ${maxVal.toFixed(1)} dBZ`);

    // Create canvas for rendering
    const canvasSize = RADAR_CONFIG.CANVAS_SIZE;
    const canvas = document.createElement('canvas');
    canvas.width = canvasSize;
    canvas.height = canvasSize;
    const ctx = canvas.getContext('2d');

    ctx.clearRect(0, 0, canvasSize, canvasSize);

    // Calculate scale
    const maxRange = ranges[ranges.length - 1];
    const scale = (canvasSize / 2) / maxRange;

    // Draw each radial
    for (let ray = 0; ray < nrays; ray++) {
        const azimuth = azimuths[ray];
        const azimuthRad = (azimuth - 90) * Math.PI / 180;

        for (let gate = 0; gate < ngates; gate++) {
            const val = refData[ray][gate];

            if (val === null || val === undefined || isNaN(val)) {
                continue;
            }

            const normalized = (val - minVal) / (maxVal - minVal);
            const color = valueToRainbowColor(normalized);

            const range = ranges[gate];
            const x = canvasSize / 2 + range * Math.cos(azimuthRad) * scale;
            const y = canvasSize / 2 + range * Math.sin(azimuthRad) * scale;

            const nextRange = gate < ngates - 1 ? ranges[gate + 1] : range + (range - (gate > 0 ? ranges[gate - 1] : 0));
            const gateWidth = (nextRange - range) * scale;

            ctx.fillStyle = color;
            ctx.globalAlpha = RADAR_CONFIG.DATA_OPACITY;

            const size = Math.max(gateWidth, 2);
            ctx.fillRect(x - size / 2, y - size / 2, size, size);
        }
    }

    ctx.globalAlpha = 1.0;

    // Convert canvas to image
    const imageUrl = canvas.toDataURL('image/png');

    // Calculate geographic bounds
    const maxRangeMeters = maxRange;
    const north = calculateDestinationPoint(center, maxRangeMeters, 0);
    const south = calculateDestinationPoint(center, maxRangeMeters, 180);
    const east = calculateDestinationPoint(center, maxRangeMeters, 90);
    const west = calculateDestinationPoint(center, maxRangeMeters, 270);

    const map = getMap();
    const bounds = new google.maps.LatLngBounds(
        new google.maps.LatLng(south.lat, west.lng),
        new google.maps.LatLng(north.lat, east.lng)
    );

    // Set overlay
    setRadarOverlay(imageUrl, bounds, RADAR_CONFIG.HEATMAP_OPACITY);

    console.log('Heatmap overlay created successfully');

    // Get elevation angle
    const firstRadial = nexradFile.radialRecords[nexradFile.scans[scanIndex].indices[0]];
    const elevAngle = firstRadial.msg_header.elevation_angle;

    return {
        nrays,
        ngates,
        elevAngle,
        minVal,
        maxVal
    };
}

/**
 * Update reflectivity legend
 */
export function updateLegend(minVal, maxVal) {
    const legendElement = document.getElementById('reflectivityLegend');
    const canvas = document.getElementById('legendCanvas');
    const ticksSvg = document.getElementById('legendTicks');
    const minLabel = document.getElementById('legendMin');
    const midLabel = document.getElementById('legendMid');
    const maxLabel = document.getElementById('legendMax');
    const zoomControlsElement = document.getElementById('mapZoomControls');

    if (!legendElement || !canvas) return;

    legendElement.style.display = 'block';

    // Show custom zoom controls with the legend
    if (zoomControlsElement) {
        zoomControlsElement.style.display = 'flex';
    }

    const midVal = (minVal + maxVal) / 2;
    minLabel.textContent = minVal.toFixed(0);
    midLabel.textContent = midVal.toFixed(0);
    maxLabel.textContent = maxVal.toFixed(0);

    const dpr = window.devicePixelRatio || 1;
    const width = 200;
    const height = 20;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';

    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    for (let x = 0; x < width; x++) {
        const normalizedValue = x / (width - 1);
        const color = valueToRainbowColor(normalizedValue);
        ctx.fillStyle = color;
        ctx.fillRect(x, 0, 1, height);
    }

    // Draw tick marks
    ticksSvg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    ticksSvg.innerHTML = '';

    const tickPositions = [
        { x: 0 },
        { x: width / 2 },
        { x: width }
    ];

    tickPositions.forEach(tick => {
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', tick.x);
        line.setAttribute('y1', height);
        line.setAttribute('x2', tick.x);
        line.setAttribute('y2', height + 6);
        line.setAttribute('stroke', '#718096');
        line.setAttribute('stroke-width', '1.5');
        line.setAttribute('stroke-linecap', 'round');
        ticksSvg.appendChild(line);
    });
}

/**
 * Hide the legend
 */
export function hideLegend() {
    const legendElement = document.getElementById('reflectivityLegend');
    const zoomControlsElement = document.getElementById('mapZoomControls');

    if (legendElement) {
        legendElement.style.display = 'none';
    }

    // Hide custom zoom controls with the legend
    if (zoomControlsElement) {
        zoomControlsElement.style.display = 'none';
    }
}

/**
 * Get current reflectivity range
 */
export function getReflectivityRange() {
    return {
        min: minReflectivity,
        max: maxReflectivity
    };
}

/**
 * Get current scan index
 */
export function getCurrentScanIndex() {
    return currentScanIndex;
}

/**
 * Generate zoom window radar data
 */
export function generateZoomRadarData(radarData, latLng, radarCenter, windowSize) {
    if (!radarData || !radarData.nexradFile || currentScanIndex === null) {
        return null;
    }

    const nexradFile = radarData.nexradFile;
    const scanIndex = currentScanIndex;

    const scanInfo = nexradFile.scan_info([scanIndex])[0];
    if (!scanInfo || !scanInfo.moments.includes('REF')) {
        return null;
    }

    const ngates = scanInfo.ngates.REF;
    const nrays = scanInfo.nrays;
    const azimuths = nexradFile.get_azimuth_angles([scanIndex]);
    const ranges = nexradFile.get_range(scanIndex, 'REF');
    const reflectivity = nexradFile.get_data('REF', ngates, [scanIndex], false);

    return {
        azimuths,
        ranges,
        reflectivity,
        nrays,
        ngates,
        minVal: minReflectivity,
        maxVal: maxReflectivity
    };
}

// Export color function for use in zoom window
export { valueToRainbowColor };
