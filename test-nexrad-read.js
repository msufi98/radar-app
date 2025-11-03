import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

async function readNexradDirectly() {
    console.log('\n🔍 Reading NEXRAD file directly using Java tools\n');

    try {
        // Try to dump the structure of the NEXRAD file
        const jarPath = 'netcdfAll-5.9.1.jar';

        // First, let's see what the file looks like
        console.log('1. Checking file structure with Ncdump...\n');
        const dumpCommand = `java -cp ${jarPath} ucar.nc2.write.Ncdump KGRR20140808_010744_V06.gz -vall`;

        console.log('Command:', dumpCommand);
        const { stdout, stderr } = await execAsync(dumpCommand, { maxBuffer: 10 * 1024 * 1024 }); // 10MB buffer

        if (stderr && !stderr.includes('SLF4J')) {
            console.error('Warnings:', stderr);
        }

        // Parse the output to find radar variables
        const lines = stdout.split('\n');
        const variables = [];
        let inVariableSection = false;
        let dimensionInfo = {};

        console.log('='.repeat(60));
        console.log('NEXRAD FILE STRUCTURE');
        console.log('='.repeat(60) + '\n');

        for (const line of lines) {
            const trimmed = line.trim();

            // Capture dimensions
            if (trimmed.includes('dimensions:')) {
                inVariableSection = false;
                console.log('📐 DIMENSIONS FOUND');
            } else if (trimmed.includes('= ') && !inVariableSection && !trimmed.includes('=', trimmed.indexOf('=') + 1)) {
                const [name, size] = trimmed.split('=').map(s => s.trim());
                if (name && size) {
                    dimensionInfo[name] = size.replace(';', '').trim();
                    console.log(`  ${name}: ${dimensionInfo[name]}`);
                }
            }

            // Capture variables
            if (trimmed.includes('variables:')) {
                inVariableSection = true;
                console.log('\n📊 VARIABLES FOUND');
            } else if (inVariableSection && trimmed.includes('(') && trimmed.includes(')')) {
                const match = trimmed.match(/(\w+)\s+(\w+)\((.*?)\)/);
                if (match) {
                    const varInfo = {
                        type: match[1],
                        name: match[2],
                        dimensions: match[3]
                    };
                    variables.push(varInfo);
                    console.log(`  ${varInfo.name} (${varInfo.type}): dims=${varInfo.dimensions || 'scalar'}`);
                }
            }

            // Stop at data section
            if (trimmed.includes('data:')) {
                break;
            }
        }

        // Look for specific radar variables
        console.log('\n🎯 RADAR VARIABLES CHECK:');
        const radarVars = ['Reflectivity', 'Velocity', 'SpectrumWidth', 'DifferentialReflectivity'];
        for (const radarVar of radarVars) {
            const found = variables.find(v => v.name.includes(radarVar));
            if (found) {
                console.log(`  ✅ ${radarVar} found: ${found.name}`);
            } else {
                console.log(`  ❌ ${radarVar} not found`);
            }
        }

        // Extract some metadata
        console.log('\n📝 METADATA:');
        const stationMatch = stdout.match(/StationName\s*=\s*"([^"]+)"/);
        const latMatch = stdout.match(/StationLatitude\s*=\s*([\d.-]+)/);
        const lonMatch = stdout.match(/StationLongitude\s*=\s*([\d.-]+)/);

        if (stationMatch) console.log(`  Station: ${stationMatch[1]}`);
        if (latMatch) console.log(`  Latitude: ${latMatch[1]}`);
        if (lonMatch) console.log(`  Longitude: ${lonMatch[1]}`);

        console.log('\n' + '='.repeat(60));
        console.log(`Total variables found: ${variables.length}`);
        console.log(`Total dimensions: ${Object.keys(dimensionInfo).length}`);
        console.log('='.repeat(60) + '\n');

        // Try to convert with different parameters
        console.log('\n2. Attempting conversion with explicit format...\n');
        const convertCommand = `java -cp ${jarPath} ucar.nc2.write.Nccopy -i KGRR20140808_010744_V06.gz -o converted/output.nc -f netcdf3`;

        console.log('Convert command:', convertCommand);
        const result = await execAsync(convertCommand);
        console.log('Conversion result:', result.stdout);

    } catch (error) {
        console.error('Error:', error.message);
        if (error.stdout) {
            console.log('Output:', error.stdout.substring(0, 1000));
        }
    }
}

readNexradDirectly();