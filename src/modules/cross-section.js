/**
 * Cross-Section Module
 * Handles vertical cross-section visualization showing all elevation scans
 */

import { valueToRainbowColor } from './radar-display.js';

// Cross-section state
let crossSectionActive = false;
let currentRadarData = null;
let currentAzimuth = null;
let numRangeBins = 100;

/**
 * Calculate beam height above radar accounting for Earth curvature
 * Uses 4/3 effective Earth radius model for standard atmosphere
 */
function calculateBeamHeight(range, elevAngle) {
    const EARTH_RADIUS = 6371000;  // meters
    const EFFECTIVE_RADIUS_FACTOR = 4/3;
    const Re = EARTH_RADIUS * EFFECTIVE_RADIUS_FACTOR;

    const elevRad = elevAngle * Math.PI / 180;

    // Height calculation with Earth curvature
    const height = Math.sqrt(
        range * range +
        Re * Re +
        2 * range * Re * Math.sin(elevRad)
    ) - Re;

    return height;
}

/**
 * Extract vertical cross-section data along a specific azimuth
 */
function extractCrossSection(radarData, targetAzimuth, rangeBins = 100) {
    const nexradFile = radarData.nexradFile;
    const results = {
        azimuth: targetAzimuth,
        elevations: [],
        ranges: [],
        data: [],
        effectiveMaxRange: 0
    };

    let maxRange = 0;
    let effectiveMaxRange = 0;

    // Temporary storage for raw data before binning
    const rawData = [];

    // Iterate through each elevation scan
    for (let scanIdx = 0; scanIdx < nexradFile.nscans; scanIdx++) {
        const scanInfo = nexradFile.scan_info([scanIdx])[0];

        // Skip if no reflectivity data
        if (!scanInfo.moments.includes('REF')) continue;

        const azimuths = nexradFile.get_azimuth_angles([scanIdx]);
        const ranges = nexradFile.get_range(scanIdx, 'REF');
        const refData = nexradFile.get_data('REF', scanInfo.ngates.REF, [scanIdx], false);
        const elevAngle = nexradFile.radialRecords[nexradFile.scans[scanIdx].indices[0]].msg_header.elevation_angle;

        maxRange = Math.max(maxRange, ranges[ranges.length - 1]);

        // Find radial closest to target azimuth
        let closestRayIdx = 0;
        let minDiff = 360;

        for (let rayIdx = 0; rayIdx < azimuths.length; rayIdx++) {
            let diff = Math.abs(azimuths[rayIdx] - targetAzimuth);
            if (diff > 180) diff = 360 - diff;

            if (diff < minDiff) {
                minDiff = diff;
                closestRayIdx = rayIdx;
            }
        }

        // Find the furthest non-null gate for this elevation
        for (let gateIdx = ranges.length - 1; gateIdx >= 0; gateIdx--) {
            const value = refData[closestRayIdx][gateIdx];
            if (value !== null && value !== undefined && !isNaN(value)) {
                effectiveMaxRange = Math.max(effectiveMaxRange, ranges[gateIdx]);
                break;
            }
        }

        results.elevations.push(elevAngle);
        rawData.push({ elevAngle, ranges, refData: refData[closestRayIdx] });
    }

    // Add 5% safety margin to avoid clipping data at edges
    effectiveMaxRange = Math.max(effectiveMaxRange * 1.05, ranges[0] || 0);
    results.effectiveMaxRange = effectiveMaxRange;

    // Now bin data using effective max range
    const binSize = effectiveMaxRange / rangeBins;

    for (const { ranges, refData } of rawData) {
        const dataRow = [];

        for (let bin = 0; bin < rangeBins; bin++) {
            const binStart = bin * binSize;
            const binEnd = (bin + 1) * binSize;
            let maxInBin = null;

            for (let gateIdx = 0; gateIdx < ranges.length; gateIdx++) {
                if (ranges[gateIdx] >= binStart && ranges[gateIdx] < binEnd) {
                    const value = refData[gateIdx];
                    if (value !== null && (maxInBin === null || value > maxInBin)) {
                        maxInBin = value;
                    }
                }
            }

            dataRow.push(maxInBin);
        }

        results.data.push(dataRow);
    }

    // Create range bin centers based on effective max range
    for (let bin = 0; bin < rangeBins; bin++) {
        results.ranges.push((bin + 0.5) * binSize);
    }

    return results;
}

/**
 * Draw vertical cross-section on canvas
 */
function drawCrossSection(crossSectionData, canvas) {
    const ctx = canvas.getContext('2d');
    const canvasWidth = 380;
    const canvasHeight = 300;
    const dpr = window.devicePixelRatio || 1;

    canvas.width = canvasWidth * dpr;
    canvas.height = canvasHeight * dpr;
    canvas.style.width = canvasWidth + 'px';
    canvas.style.height = canvasHeight + 'px';

    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);

    const { elevations, ranges, data, effectiveMaxRange } = crossSectionData;

    if (elevations.length === 0) {
        ctx.fillStyle = '#666';
        ctx.font = '14px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('No data available', canvasWidth / 2, canvasHeight / 2);
        return;
    }

    // Calculate scales
    const leftMargin = 20;
    const rightMargin = 60;
    const topMargin = 20;
    const bottomMargin = 40;

    const plotWidth = canvasWidth - leftMargin - rightMargin;
    const plotHeight = canvasHeight - topMargin - bottomMargin;

    const maxRange = effectiveMaxRange || ranges[ranges.length - 1];
    const maxHeight = calculateBeamHeight(maxRange, Math.max(...elevations));

    const rangeScale = plotWidth / maxRange;
    const heightScale = plotHeight / maxHeight;

    // Draw grid
    ctx.strokeStyle = 'rgba(200, 200, 200, 0.3)';
    ctx.lineWidth = 0.5;

    // Vertical grid lines (every 50km)
    for (let r = 0; r <= maxRange; r += 50000) {
        const x = leftMargin + r * rangeScale;
        ctx.beginPath();
        ctx.moveTo(x, topMargin);
        ctx.lineTo(x, canvasHeight - bottomMargin);
        ctx.stroke();
    }

    // Horizontal grid lines (every 5km height)
    for (let h = 0; h <= maxHeight; h += 5000) {
        const y = canvasHeight - bottomMargin - h * heightScale;
        ctx.beginPath();
        ctx.moveTo(leftMargin, y);
        ctx.lineTo(canvasWidth - rightMargin, y);
        ctx.stroke();
    }

    // Draw each elevation scan
    for (let elevIdx = 0; elevIdx < elevations.length; elevIdx++) {
        const elevAngle = elevations[elevIdx];
        const dataRow = data[elevIdx];

        // Draw beam path
        ctx.strokeStyle = 'rgba(128, 128, 128, 0.2)';
        ctx.lineWidth = 0.5;
        ctx.beginPath();

        for (let rangeIdx = 0; rangeIdx < ranges.length; rangeIdx++) {
            const range = ranges[rangeIdx];
            const height = calculateBeamHeight(range, elevAngle);
            const x = leftMargin + range * rangeScale;
            const y = canvasHeight - bottomMargin - height * heightScale;

            if (rangeIdx === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
        }
        ctx.stroke();

        // Draw reflectivity data
        for (let rangeIdx = 0; rangeIdx < ranges.length; rangeIdx++) {
            const value = dataRow[rangeIdx];
            if (value === null) continue;

            const range = ranges[rangeIdx];
            const height = calculateBeamHeight(range, elevAngle);
            const x = leftMargin + range * rangeScale;
            const y = canvasHeight - bottomMargin - height * heightScale;

            const color = valueToRainbowColor(value);
            ctx.fillStyle = color;
            ctx.fillRect(x - 2, y - 2, 4, 4);
        }
    }

    // Draw axes
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(leftMargin, canvasHeight - bottomMargin);
    ctx.lineTo(canvasWidth - rightMargin, canvasHeight - bottomMargin);
    ctx.lineTo(canvasWidth - rightMargin, topMargin);
    ctx.stroke();

    // Draw labels
    ctx.fillStyle = '#000';
    ctx.font = '12px Arial';
    ctx.textAlign = 'center';

    // X-axis labels (range in km)
    for (let r = 0; r <= maxRange; r += 50000) {
        const x = leftMargin + r * rangeScale;
        const y = canvasHeight - bottomMargin + 20;
        ctx.fillText((r / 1000).toFixed(0), x, y);
    }

    // X-axis title
    ctx.font = 'bold 13px Arial';
    ctx.fillText('Range (km)', canvasWidth / 2, canvasHeight - 5);

    // Y-axis labels (height in km) - on the right
    ctx.font = '12px Arial';
    ctx.textAlign = 'left';
    for (let h = 0; h <= maxHeight; h += 5000) {
        const x = canvasWidth - rightMargin + 10;
        const y = canvasHeight - bottomMargin - h * heightScale + 4;
        ctx.fillText((h / 1000).toFixed(0), x, y);
    }

    // Y-axis title - on the right
    ctx.save();
    ctx.translate(canvasWidth - 15, canvasHeight / 2);
    ctx.rotate(Math.PI / 2);
    ctx.font = 'bold 13px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('Height (km)', 0, 0);
    ctx.restore();
}

/**
 * Update cross-section for a given azimuth
 */
export function updateCrossSection(radarData, azimuth) {
    if (!crossSectionActive || !radarData) return;

    currentRadarData = radarData;
    currentAzimuth = azimuth;

    const canvas = document.getElementById('crossSectionCanvas');
    const infoDiv = document.getElementById('crossSectionInfo');

    if (!canvas) return;

    // Update info
    if (infoDiv) {
        infoDiv.textContent = `Azimuth: ${azimuth.toFixed(1)}°`;
    }

    // Extract and draw cross-section
    const crossSectionData = extractCrossSection(radarData, azimuth, numRangeBins);
    drawCrossSection(crossSectionData, canvas);
}

/**
 * Enable cross-section feature
 */
export function enableCrossSection(radarData) {
    crossSectionActive = true;
    currentRadarData = radarData;

    // Show cross-section window
    const crossSectionWindow = document.getElementById('crossSectionWindow');
    if (crossSectionWindow) {
        crossSectionWindow.style.display = 'block';
    }

    console.log('Cross-section feature enabled');
}

/**
 * Disable cross-section feature
 */
export function disableCrossSection() {
    crossSectionActive = false;
    currentRadarData = null;
    currentAzimuth = null;

    // Hide cross-section window
    const crossSectionWindow = document.getElementById('crossSectionWindow');
    if (crossSectionWindow) {
        crossSectionWindow.style.display = 'none';
    }

    console.log('Cross-section feature disabled');
}
