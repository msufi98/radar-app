/**
 * Cross-Section Module
 * Handles vertical cross-section visualization showing all elevation scans
 */

import { valueToRainbowColor } from './radar-display.js';

// Cross-section state
let crossSectionActive = false;
let currentRange = null;
let numRangeBins = 100;

// Arc cross-section configuration
const ARC_HALF_WIDTH = 15; // ±15 degrees
const ARC_MAX_HEIGHT = 10000; // 10 km fixed height

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
    effectiveMaxRange = effectiveMaxRange > 0 ? effectiveMaxRange * 1.05 : maxRange;
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
    const canvasWidth = 330;
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

        // Draw elevation angle label at the end of the beam path
        const labelRange = ranges[ranges.length - 1];
        const labelHeight = calculateBeamHeight(labelRange, elevAngle);
        const labelX = leftMargin + labelRange * rangeScale;
        const labelY = canvasHeight - bottomMargin - labelHeight * heightScale;

        ctx.fillStyle = 'rgba(128, 128, 128, 0.5)';
        ctx.font = '9px Arial';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'bottom';
        ctx.fillText(`${elevAngle.toFixed(1)}°`, labelX - 2, labelY - 2);

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
 * Update cross-section for a given azimuth and range
 */
export function updateCrossSection(radarData, azimuth, range = null) {
    if (!crossSectionActive || !radarData) return;

    if (range !== null) {
        currentRange = range;
    }

    const canvas = document.getElementById('crossSectionCanvas');
    const infoDiv = document.getElementById('crossSectionInfo');

    if (!canvas) return;

    // Update info
    if (infoDiv) {
        infoDiv.textContent = `Azimuth: ${azimuth.toFixed(1)}°`;
    }

    // Extract and draw vertical cross-section
    const crossSectionData = extractCrossSection(radarData, azimuth, numRangeBins);
    drawCrossSection(crossSectionData, canvas);

    // Update arc cross-section if we have a range
    if (currentRange !== null) {
        updateArcCrossSection(radarData, azimuth, currentRange);
    }
}

/**
 * Update arc cross-section with current azimuth and range
 */
function updateArcCrossSection(radarData, azimuth, range) {
    if (!crossSectionActive || !radarData) return;

    const canvas = document.getElementById('horizontalCrossSectionCanvas');
    const infoDiv = document.getElementById('arcCrossSectionInfo');
    if (!canvas) return;

    // Update info display
    if (infoDiv) {
        infoDiv.textContent = `Range: ${(range / 1000).toFixed(2)} km`;
    }

    // Extract and draw arc cross-section
    const arcData = extractArcCrossSection(radarData, azimuth, range);
    drawArcCrossSection(arcData, canvas, azimuth);
}

/**
 * Extract arc cross-section data (±15° arc at a specific range, all elevations)
 * Shows height vs azimuth offset at a fixed range
 */
function extractArcCrossSection(radarData, targetAzimuth, targetRange) {
    const nexradFile = radarData.nexradFile;
    const results = {
        azimuthOffsets: [],  // -15 to +15 degrees
        elevations: [],
        data: [],  // 2D array: [azimuthOffset][elevation] = value
        centerAzimuth: targetAzimuth,
        targetRange: targetRange
    };

    const azimuthBins = 31; // -15 to +15 in 1-degree steps

    // Initialize azimuth offsets (-15 to +15)
    for (let i = 0; i < azimuthBins; i++) {
        results.azimuthOffsets.push(i - ARC_HALF_WIDTH);
        results.data.push([]);
    }

    // Iterate through each elevation scan to build height dimension
    for (let scanIdx = 0; scanIdx < nexradFile.nscans; scanIdx++) {
        const scanInfo = nexradFile.scan_info([scanIdx])[0];

        // Skip if no reflectivity data
        if (!scanInfo.moments.includes('REF')) continue;

        const azimuths = nexradFile.get_azimuth_angles([scanIdx]);
        const ranges = nexradFile.get_range(scanIdx, 'REF');
        const refData = nexradFile.get_data('REF', scanInfo.ngates.REF, [scanIdx], false);
        const elevAngle = nexradFile.radialRecords[nexradFile.scans[scanIdx].indices[0]].msg_header.elevation_angle;

        // Calculate height at target range for this elevation
        const height = calculateBeamHeight(targetRange, elevAngle);

        // Skip if height exceeds our display range
        if (height > ARC_MAX_HEIGHT) continue;

        results.elevations.push({ angle: elevAngle, height: height, scanIdx: scanIdx });

        // Find the range gate closest to target range
        let closestGateIdx = 0;
        let minRangeDiff = Infinity;
        for (let gateIdx = 0; gateIdx < ranges.length; gateIdx++) {
            const diff = Math.abs(ranges[gateIdx] - targetRange);
            if (diff < minRangeDiff) {
                minRangeDiff = diff;
                closestGateIdx = gateIdx;
            }
        }

        // For each azimuth offset bin, find the closest radial and get value
        for (let azBinIdx = 0; azBinIdx < azimuthBins; azBinIdx++) {
            const azOffset = results.azimuthOffsets[azBinIdx];
            let targetAz = targetAzimuth + azOffset;

            // Normalize to 0-360
            if (targetAz < 0) targetAz += 360;
            if (targetAz >= 360) targetAz -= 360;

            // Find closest radial to this azimuth
            let closestRayIdx = 0;
            let minAzDiff = 360;
            for (let rayIdx = 0; rayIdx < azimuths.length; rayIdx++) {
                let diff = Math.abs(azimuths[rayIdx] - targetAz);
                if (diff > 180) diff = 360 - diff;
                if (diff < minAzDiff) {
                    minAzDiff = diff;
                    closestRayIdx = rayIdx;
                }
            }

            // Get value at this azimuth and range
            const value = refData[closestRayIdx][closestGateIdx];
            results.data[azBinIdx].push(value);
        }
    }

    return results;
}

/**
 * Draw arc cross-section on canvas
 * X-axis: azimuth offset (-15° to +15°)
 * Y-axis: height (0 to max elevation height)
 */
function drawArcCrossSection(arcData, canvas, centerAzimuth) {
    const ctx = canvas.getContext('2d');
    const canvasWidth = 330;
    const canvasHeight = 300;
    const dpr = window.devicePixelRatio || 1;

    canvas.width = canvasWidth * dpr;
    canvas.height = canvasHeight * dpr;
    canvas.style.width = canvasWidth + 'px';
    canvas.style.height = canvasHeight + 'px';

    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);

    const { azimuthOffsets, elevations, data } = arcData;

    if (elevations.length === 0 || azimuthOffsets.length === 0) {
        ctx.fillStyle = '#666';
        ctx.font = '14px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('No data available', canvasWidth / 2, canvasHeight / 2);
        return;
    }

    // Margins
    const leftMargin = 20;
    const rightMargin = 60;
    const topMargin = 20;
    const bottomMargin = 40;

    const plotWidth = canvasWidth - leftMargin - rightMargin;
    const plotHeight = canvasHeight - topMargin - bottomMargin;

    // Sort elevations by height for proper drawing order
    const sortedElevations = [...elevations].sort((a, b) => a.height - b.height);

    // Calculate max height from topmost elevation (add 10% margin)
    const topElevHeight = sortedElevations[sortedElevations.length - 1].height;
    const maxHeight = topElevHeight * 1.1;

    // Calculate scales
    const azScale = plotWidth / (ARC_HALF_WIDTH * 2); // 30 degree span
    const heightScale = plotHeight / maxHeight;

    // Draw data points - interpolate between elevation heights
    for (let azIdx = 0; azIdx < azimuthOffsets.length; azIdx++) {
        const azOffset = azimuthOffsets[azIdx];
        const x = leftMargin + (azOffset + ARC_HALF_WIDTH) * azScale;

        // For each pair of adjacent elevations, draw a colored rectangle
        for (let elevIdx = 0; elevIdx < sortedElevations.length; elevIdx++) {
            const elev = sortedElevations[elevIdx];
            const origElevIdx = elevations.findIndex(e => e.scanIdx === elev.scanIdx);
            const value = data[azIdx][origElevIdx];

            if (value === null || value === undefined) continue;

            // Calculate height band for this elevation
            const height = elev.height;
            let heightTop, heightBottom;

            if (elevIdx === 0) {
                // First elevation - extend down to 0
                heightBottom = 0;
                heightTop = elevIdx < sortedElevations.length - 1
                    ? (height + sortedElevations[elevIdx + 1].height) / 2
                    : height * 1.2;
            } else if (elevIdx === sortedElevations.length - 1) {
                // Last elevation - extend up slightly
                heightBottom = (height + sortedElevations[elevIdx - 1].height) / 2;
                heightTop = Math.min(height * 1.1, maxHeight);
            } else {
                // Middle elevations
                heightBottom = (height + sortedElevations[elevIdx - 1].height) / 2;
                heightTop = (height + sortedElevations[elevIdx + 1].height) / 2;
            }

            const yTop = canvasHeight - bottomMargin - heightTop * heightScale;
            const yBottom = canvasHeight - bottomMargin - heightBottom * heightScale;
            const rectHeight = yBottom - yTop;

            const color = valueToRainbowColor(value);
            ctx.fillStyle = color;
            ctx.fillRect(x - azScale / 2, yTop, azScale + 1, rectHeight + 1);
        }
    }

    // Draw grid
    ctx.strokeStyle = 'rgba(200, 200, 200, 0.3)';
    ctx.lineWidth = 0.5;

    // Vertical grid lines (every 5°)
    for (let az = -ARC_HALF_WIDTH; az <= ARC_HALF_WIDTH; az += 5) {
        const x = leftMargin + (az + ARC_HALF_WIDTH) * azScale;
        ctx.beginPath();
        ctx.moveTo(x, topMargin);
        ctx.lineTo(x, canvasHeight - bottomMargin);
        ctx.stroke();
    }

    // Calculate appropriate height grid interval based on max height
    const heightGridInterval = maxHeight > 8000 ? 2000 : (maxHeight > 4000 ? 1000 : 500);

    // Horizontal grid lines
    for (let h = 0; h <= maxHeight; h += heightGridInterval) {
        const y = canvasHeight - bottomMargin - h * heightScale;
        ctx.beginPath();
        ctx.moveTo(leftMargin, y);
        ctx.lineTo(canvasWidth - rightMargin, y);
        ctx.stroke();
    }

    // Draw center line (current azimuth)
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.8)';
    ctx.lineWidth = 2;
    const centerX = leftMargin + ARC_HALF_WIDTH * azScale;
    ctx.beginPath();
    ctx.moveTo(centerX, topMargin);
    ctx.lineTo(centerX, canvasHeight - bottomMargin);
    ctx.stroke();

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

    // X-axis labels (azimuth offset)
    for (let az = -ARC_HALF_WIDTH; az <= ARC_HALF_WIDTH; az += 5) {
        const x = leftMargin + (az + ARC_HALF_WIDTH) * azScale;
        const y = canvasHeight - bottomMargin + 20;
        // Show actual azimuth values
        let actualAz = centerAzimuth + az;
        if (actualAz < 0) actualAz += 360;
        if (actualAz >= 360) actualAz -= 360;
        ctx.fillText(`${actualAz.toFixed(0)}°`, x, y);
    }

    // X-axis title with center azimuth indicator
    ctx.font = 'bold 13px Arial';
    ctx.fillText(`Azimuth (${centerAzimuth.toFixed(1)}° ± ${ARC_HALF_WIDTH}°)`, canvasWidth / 2, canvasHeight - 5);

    // Y-axis labels (height in km) - on the right
    ctx.font = '12px Arial';
    ctx.textAlign = 'left';
    for (let h = 0; h <= maxHeight; h += heightGridInterval) {
        const x = canvasWidth - rightMargin + 10;
        const y = canvasHeight - bottomMargin - h * heightScale + 4;
        ctx.fillText((h / 1000).toFixed(1), x, y);
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
 * Enable cross-section feature
 */
export function enableCrossSection() {
    crossSectionActive = true;
    currentRange = null;

    // Show cross-section windows
    const crossSectionWindow = document.getElementById('crossSectionWindow');
    if (crossSectionWindow) {
        crossSectionWindow.style.display = 'block';
    }

    const horizontalCrossSectionWindow = document.getElementById('horizontalCrossSectionWindow');
    if (horizontalCrossSectionWindow) {
        horizontalCrossSectionWindow.style.display = 'block';
    }

    console.log('Cross-section feature enabled');
}

/**
 * Disable cross-section feature
 */
export function disableCrossSection() {
    crossSectionActive = false;
    currentRange = null;

    // Hide cross-section windows
    const crossSectionWindow = document.getElementById('crossSectionWindow');
    if (crossSectionWindow) {
        crossSectionWindow.style.display = 'none';
    }

    const horizontalCrossSectionWindow = document.getElementById('horizontalCrossSectionWindow');
    if (horizontalCrossSectionWindow) {
        horizontalCrossSectionWindow.style.display = 'none';
    }

    console.log('Cross-section feature disabled');
}
