const fs = require('fs');
const path = require('path');

const inputPath = path.join(__dirname, '../structured_inventory.json');
const outputPath = path.join(__dirname, 'data.js');

const rawData = JSON.parse(fs.readFileSync(inputPath, 'utf8'));

const jsContent = `/**
 * Master Inventory Data - MAserver
 * Total Categories: ${rawData.length}
 */
const MASTER_INVENTORY = ${JSON.stringify(rawData, null, 2)};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = MASTER_INVENTORY;
}
`;

fs.writeFileSync(outputPath, jsContent, 'utf8');
console.log('Successfully written data.js with', rawData.length, 'categories');
