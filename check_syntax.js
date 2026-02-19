const fs = require('fs');
const code = fs.readFileSync('D:\\gardening\\js\\booking.js', 'utf8');
try {
    new Function(code);
    console.log('SYNTAX OK - no errors');
} catch(e) {
    console.log('SYNTAX ERROR:', e.message);
}
