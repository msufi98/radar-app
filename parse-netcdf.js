import fs from 'fs';
import { NetCDFReader } from 'netcdfjs';

/**
 * Parse NetCDF file and display its structure
 * @param {string} filePath - Path to NetCDF file
 */
function parseNetCDF(filePath) {
    console.log(`\n📂 Reading NetCDF file: ${filePath}\n`);

    // Read the file
    const data = fs.readFileSync(filePath);

    // Parse NetCDF
    const reader = new NetCDFReader(data);

    console.log('='.repeat(60));
    console.log('NETCDF FILE STRUCTURE');
    console.log('='.repeat(60));

    // File info
    console.log('\n📊 File Information:');
    console.log(`Version: ${reader.version}`);
    console.log(`Record Dimension: ${reader.recordDimension?.name || 'None'}`);

    // Dimensions
    console.log('\n📐 Dimensions:');
    if (reader.dimensions && reader.dimensions.length > 0) {
        reader.dimensions.forEach(dim => {
            console.log(`  - ${dim.name}: ${dim.size}`);
        });
    } else {
        console.log('  No dimensions found');
    }

    // Global Attributes
    console.log('\n🌍 Global Attributes:');
    if (reader.globalAttributes && reader.globalAttributes.length > 0) {
        reader.globalAttributes.forEach(attr => {
            const value = attr.value;
            const displayValue = typeof value === 'string' ? value :
                               Array.isArray(value) ? `[${value.slice(0, 3).join(', ')}...]` : value;
            console.log(`  - ${attr.name}: ${displayValue}`);
        });
    } else {
        console.log('  No global attributes found');
    }

    // Variables
    console.log('\n📈 Variables:');
    if (reader.variables && reader.variables.length > 0) {
        reader.variables.forEach(variable => {
            console.log(`\n  Variable: ${variable.name}`);
            console.log(`    Type: ${variable.type}`);
            console.log(`    Dimensions: ${variable.dimensions.join(', ') || 'scalar'}`);
            console.log(`    Size: ${variable.size}`);

            // Variable attributes
            if (variable.attributes && variable.attributes.length > 0) {
                console.log('    Attributes:');
                variable.attributes.forEach(attr => {
                    const value = attr.value;
                    const displayValue = typeof value === 'string' ? value :
                                       Array.isArray(value) ? `[Array(${value.length})]` : value;
                    console.log(`      - ${attr.name}: ${displayValue}`);
                });
            }

            // Check for radar-specific variables
            const radarVariables = ['Reflectivity', 'Velocity', 'SpectrumWidth', 'DifferentialReflectivity'];
            if (radarVariables.some(rv => variable.name.includes(rv))) {
                console.log(`    ⚡ RADAR DATA VARIABLE DETECTED`);

                // Try to read a sample of the data
                try {
                    const data = reader.getDataVariable(variable.name);
                    if (data && data.length > 0) {
                        console.log(`    Data shape: [${data.length}]`);
                        console.log(`    Sample values: [${data.slice(0, 5).map(v => v?.toFixed ? v.toFixed(2) : v).join(', ')}...]`);

                        // Calculate statistics
                        const validData = data.filter(v => v !== null && !isNaN(v));
                        if (validData.length > 0) {
                            const min = Math.min(...validData);
                            const max = Math.max(...validData);
                            const avg = validData.reduce((a, b) => a + b, 0) / validData.length;
                            console.log(`    Statistics: Min=${min.toFixed(2)}, Max=${max.toFixed(2)}, Avg=${avg.toFixed(2)}`);
                        }
                    }
                } catch (e) {
                    console.log(`    Could not read data: ${e.message}`);
                }
            }
        });
    } else {
        console.log('  No variables found');
    }

    console.log('\n' + '='.repeat(60));
    console.log('END OF FILE STRUCTURE');
    console.log('='.repeat(60) + '\n');

    return reader;
}

// Test with the converted file
const testFile = 'converted/KGRR20140808_010744_V06.nc';

try {
    const reader = parseNetCDF(testFile);

    // Additional analysis
    console.log('\n🔍 Analysis Summary:');
    console.log(`Total dimensions: ${reader.dimensions?.length || 0}`);
    console.log(`Total variables: ${reader.variables?.length || 0}`);
    console.log(`Total global attributes: ${reader.globalAttributes?.length || 0}`);

    // Check if this looks like valid NEXRAD data
    const hasRadarData = reader.variables?.some(v =>
        v.name.includes('Reflectivity') ||
        v.name.includes('Velocity') ||
        v.name.includes('SpectrumWidth')
    );

    if (hasRadarData) {
        console.log('\n✅ This appears to be valid NEXRAD radar data!');
    } else {
        console.log('\n⚠️  Warning: No standard radar variables found.');
        console.log('This may not be properly formatted NEXRAD data.');
    }

} catch (error) {
    console.error('❌ Error parsing NetCDF file:', error.message);
    console.error('Stack:', error.stack);
}