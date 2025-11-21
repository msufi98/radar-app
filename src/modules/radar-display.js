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
    HEATMAP_OPACITY: 0.85, // Increased from 0.7 for better visibility
    DATA_OPACITY: 0.95
};

/**
 * Map actual dBZ value to NEXRAD-inspired bucketed colors
 * Uses absolute dBZ thresholds, not normalized range
 */
function valueToRainbowColor(dbzValue) {
    // 7 color buckets based on absolute dBZ values (NEXRAD Level 3)
    if (dbzValue < 5) {
        return 'rgb(0, 189, 250)'; // Light Cyan #00BDFA (< 5 dBZ)
    }
    else if (dbzValue < 15) {
        return 'rgb(0, 205, 231)'; // Cyan #00CDE7 (5-15 dBZ)
    }
    else if (dbzValue < 30) {
        return 'rgb(0, 157, 0)'; // Green #009D00 (15-30 dBZ)
    }
    else if (dbzValue < 40) {
        return 'rgb(255, 255, 0)'; // Yellow #FFFF00 (30-40 dBZ)
    }
    else if (dbzValue < 50) {
        return 'rgb(254, 83, 0)'; // Orange-Red #FE5300 (40-50 dBZ)
    }
    else if (dbzValue < 65) {
        return 'rgb(228, 0, 127)'; // Magenta-Red #E4007F (50-65 dBZ)
    }
    else {
        return 'rgb(254, 254, 254)'; // White #FEFEFE (65+ dBZ)
    }
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

    // Calculate effective maximum range (furthest non-null gate across all rays)
    let effectiveMaxRange = 0;
    for (let ray = 0; ray < nrays; ray++) {
        for (let gate = ngates - 1; gate >= 0; gate--) {
            const val = refData[ray][gate];
            if (val !== null && val !== undefined && !isNaN(val)) {
                effectiveMaxRange = Math.max(effectiveMaxRange, ranges[gate]);
                break; // Found furthest non-null for this ray
            }
        }
    }
    // Add 10% safety margin to avoid clipping valid data at edges
    effectiveMaxRange = Math.max(effectiveMaxRange * 1.1, ranges[0]);

    const fullRange = ranges[ranges.length - 1];
    console.log(`Effective max range: ${(effectiveMaxRange / 1000).toFixed(1)} km (vs full range: ${(fullRange / 1000).toFixed(1)} km)`);

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

    // Calculate scale using effective range for better visualization
    const maxRange = effectiveMaxRange;
    const scale = (canvasSize / 2) / maxRange;

    // Draw each radial
    for (let ray = 0; ray < nrays; ray++) {
        const azimuth = azimuths[ray];
        const azimuthRad = (azimuth - 90) * Math.PI / 180;

        for (let gate = 0; gate < ngates; gate++) {
            const range = ranges[gate];

            // Skip gates beyond effective range
            if (range > effectiveMaxRange) {
                break; // No need to check further gates on this ray
            }

            const val = refData[ray][gate];

            if (val === null || val === undefined || isNaN(val)) {
                continue;
            }

            // Use actual dBZ value for color mapping (not normalized)
            const color = valueToRainbowColor(val);

            const x = canvasSize / 2 + range * Math.cos(azimuthRad) * scale;
            const y = canvasSize / 2 + range * Math.sin(azimuthRad) * scale;

            const nextRange = gate < ngates - 1 ? ranges[gate + 1] : range + (range - (gate > 0 ? ranges[gate - 1] : 0));
            const gateWidth = (nextRange - range) * scale;

            ctx.fillStyle = color;
            ctx.globalAlpha = RADAR_CONFIG.DATA_OPACITY;

            // Progressive diffusion: increase cell size more as distance increases
            // Near center: ~1.5x, Far out: ~2.5x
            const distanceRatio = range / maxRange; // 0 at center, 1 at edge
            const sizeMultiplier = 1.5 + (distanceRatio * 1.0); // 1.5 to 2.5
            const size = Math.max(gateWidth * sizeMultiplier, 3);
            ctx.fillRect(x - size / 2, y - size / 2, size, size);
        }
    }

    ctx.globalAlpha = 1.0;

    // Apply slight blur to smooth gaps between cells
    ctx.filter = 'blur(1px)';
    ctx.drawImage(canvas, 0, 0);
    ctx.filter = 'none';

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
        maxVal,
        effectiveMaxRange
    };
}

/**
 * Update reflectivity legend
 * Now shows fixed dBZ thresholds instead of data range
 */
export function updateLegend(minVal, maxVal) {
    const legendElement = document.getElementById('reflectivityLegend');
    const canvas = document.getElementById('legendCanvas');
    const ticksSvg = document.getElementById('legendTicks');
    const minLabel = document.getElementById('legendMin');
    const midLabel = document.getElementById('legendMid');
    const maxLabel = document.getElementById('legendMax');

    if (!legendElement || !canvas) return;

    legendElement.style.display = 'block';

    // Use fixed dBZ thresholds instead of data range
    minLabel.textContent = '0';
    midLabel.textContent = '35';
    maxLabel.textContent = '70';

    const dpr = window.devicePixelRatio || 1;
    const width = 200;
    const height = 20;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';

    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    // Draw legend with actual dBZ values (0 to 70 dBZ)
    for (let x = 0; x < width; x++) {
        const dbzValue = (x / (width - 1)) * 70; // 0 to 70 dBZ
        const color = valueToRainbowColor(dbzValue);
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

    if (legendElement) {
        legendElement.style.display = 'none';
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
