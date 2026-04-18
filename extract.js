const fs = require('fs');
const html = fs.readFileSync("Prof_s_Corner_1.html", 'utf8');
const scriptStart = html.lastIndexOf('<script>');
const scriptEnd = html.lastIndexOf('</script>');
const scriptContent = html.substring(scriptStart + 8, scriptEnd);
fs.writeFileSync('test_script.js', scriptContent);
console.log('Script extracted.');
