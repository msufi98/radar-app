/**
 * Deep Data Comparison - Compare actual REF values between JS and Python
 * Verifies that decompression and scaling produce identical numerical results
 */

import { read_nexrad_archive } from '../src/nexrad_archive.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Test with KHGX file (most comprehensive)
const TEST_FILE = 's3://unidata-nexrad-level2/2022/03/22/KHGX/KHGX20220322_120125_V06';

async function compareDataValues() {
    console.log('='.repeat(80));
    console.log('Deep Data Value Comparison: JavaScript vs Python');
    console.log('='.repeat(80));
    console.log(`\nTest File: ${TEST_FILE}\n`);

    // Read with JavaScript
    console.log('Reading with JavaScript...');
    const radar = await read_nexrad_archive(TEST_FILE);

    // Get REF data
    console.log('Extracting REF moment data...');
    const range_info = radar.get_range(0, 'REF');
    const max_ngates = range_info.length;
    const refData = radar.get_data('REF', max_ngates);

    console.log(`\nJavaScript REF Data Shape: [${refData.length}, ${max_ngates}]`);

    // Calculate statistics for all radials
    const stats = {
        total_radials: refData.length,
        total_gates: max_ngates,
        total_values: 0,
        valid_values: 0,
        null_values: 0,

        // Per-radial statistics
        radial_samples: [],

        // Overall statistics (excluding nulls)
        all_valid_values: [],
        min: null,
        max: null,
        mean: null,

        // Sample radials for detailed comparison
        sample_radials: [0, 100, 500, 1000, 5000, 10000]
    };

    // Collect statistics
    for (let radial = 0; radial < refData.length; radial++) {
        const radialData = refData[radial];
        let validCount = 0;
        let nullCount = 0;
        let sum = 0;
        let radialMin = null;
        let radialMax = null;

        for (let gate = 0; gate < radialData.length; gate++) {
            stats.total_values++;
            const value = radialData[gate];

            if (value === null || value === undefined || isNaN(value)) {
                nullCount++;
                stats.null_values++;
            } else {
                validCount++;
                stats.valid_values++;
                sum += value;
                stats.all_valid_values.push(value);

                if (radialMin === null || value < radialMin) radialMin = value;
                if (radialMax === null || value > radialMax) radialMax = value;
            }
        }

        // Store sample radials
        if (stats.sample_radials.includes(radial)) {
            stats.radial_samples.push({
                radial_index: radial,
                total_gates: radialData.length,
                valid_count: validCount,
                null_count: nullCount,
                min: radialMin,
                max: radialMax,
                mean: validCount > 0 ? sum / validCount : null,
                // First 20 values for detailed comparison
                values_sample: radialData.slice(0, 20),
                // Values at specific gates
                gate_samples: {
                    gate_0: radialData[0],
                    gate_100: radialData[100],
                    gate_500: radialData[500],
                    gate_1000: radialData[1000],
                    gate_1500: radialData[1500]
                }
            });
        }
    }

    // Calculate overall statistics (avoid spread operator for large arrays)
    if (stats.all_valid_values.length > 0) {
        stats.min = stats.all_valid_values[0];
        stats.max = stats.all_valid_values[0];
        let sum = 0;

        for (const val of stats.all_valid_values) {
            if (val < stats.min) stats.min = val;
            if (val > stats.max) stats.max = val;
            sum += val;
        }

        stats.mean = sum / stats.all_valid_values.length;

        // Clear the large array to free memory
        stats.all_valid_values = null;
    }

    // Print summary statistics
    console.log('\n' + '='.repeat(80));
    console.log('JavaScript REF Data Statistics');
    console.log('='.repeat(80));
    console.log(`Total Values: ${stats.total_values.toLocaleString()}`);
    console.log(`Valid Values: ${stats.valid_values.toLocaleString()} (${(stats.valid_values / stats.total_values * 100).toFixed(2)}%)`);
    console.log(`Null Values: ${stats.null_values.toLocaleString()} (${(stats.null_values / stats.total_values * 100).toFixed(2)}%)`);
    console.log(`\nOverall Statistics (valid values only):`);
    console.log(`  Min: ${stats.min?.toFixed(4)}`);
    console.log(`  Max: ${stats.max?.toFixed(4)}`);
    console.log(`  Mean: ${stats.mean?.toFixed(4)}`);

    // Print sample radials
    console.log('\n' + '='.repeat(80));
    console.log('Sample Radials (for Python comparison)');
    console.log('='.repeat(80));

    for (const sample of stats.radial_samples) {
        console.log(`\nRadial ${sample.radial_index}:`);
        console.log(`  Valid: ${sample.valid_count}, Null: ${sample.null_count}`);
        console.log(`  Min: ${sample.min?.toFixed(4)}, Max: ${sample.max?.toFixed(4)}, Mean: ${sample.mean?.toFixed(4)}`);
        console.log(`  First 10 values: [${sample.values_sample.slice(0, 10).map(v => v === null ? 'null' : v.toFixed(2)).join(', ')}]`);
        console.log(`  Gate samples:`);
        for (const [gate, value] of Object.entries(sample.gate_samples)) {
            console.log(`    ${gate}: ${value === null ? 'null' : value.toFixed(4)}`);
        }
    }

    // Save detailed results for Python comparison
    const output = {
        test_file: TEST_FILE,
        data_shape: [refData.length, max_ngates],
        statistics: {
            total_values: stats.total_values,
            valid_values: stats.valid_values,
            null_values: stats.null_values,
            min: stats.min,
            max: stats.max,
            mean: stats.mean
        },
        radial_samples: stats.radial_samples,
        // Include full first radial for exact comparison
        first_radial_full: refData[0]
    };

    const outputPath = path.join(__dirname, 'output', 'data_comparison_js.json');
    await fs.writeFile(outputPath, JSON.stringify(output, null, 2));
    console.log(`\n✓ Detailed results saved to: ${outputPath}`);

    // Print instructions for Python comparison
    console.log('\n' + '='.repeat(80));
    console.log('Next Step: Run Python comparison');
    console.log('='.repeat(80));
    console.log('Run: python compare_data_values.py');
    console.log('Then compare output/data_comparison_js.json with output/data_comparison_py.json');
}

compareDataValues().catch(err => {
    console.error('Error:', err);
    process.exit(1);
});
