// Crafter Partner API compatibility + diagnostics patch, applied during build.
const fs=require('node:fs');
const path=require('node:path');
const serverPath=path.join(__dirname,'server.js');
let s=fs.readFileSync(serverPath,'utf8');
function change(before,after){if(!s.includes(before))throw Error('Missing patch anchor: '+before.slice(0,70));s=s.replace(before,after)}
change("const upstreamRoot = 'https://craftertg.site/api/partner/v1';", "const upstreamRoot = process.env.CRAFTER_API_BASE || 'https://craftertg.site/api/partner/v1';");
change("headers: {Authorization: `Bearer ${apiKey}`, Accept: 'application/json'},", "headers: {Authorization: `Bearer ${apiKey}`, 'X-API-Key': apiKey, Accept: 'application/json'},");
change("const response = await fetch(upstreamRoot + key, {", "console.log('[Crafter API] fetching '+key);\n    const response = await fetch(upstreamRoot + key, {");
change("if(!response.ok) {\n      const err", "console.log('[Crafter API] '+key+' HTTP '+response.status);\n    if(!response.ok) {\n      const err");
change("const data = JSON.parse(raw);\n    if(!data || data.ok !== true) throw new Error(data?.error || 'Crafter API вернул ошибку.');\n    const value = {ok:true, data, updated_at: new Date().toISOString()};", `const parsed=JSON.parse(raw);
    if(parsed?.ok === false || parsed?.success === false) throw new Error(parsed?.error || parsed?.message || 'Crafter API вернул ошибку.');
    let data = parsed?.data && typeof parsed.data === 'object' && !Array.isArray(parsed.data) ? parsed.data : parsed;
    if(Array.isArray(data) && key.startsWith('/collections'))data={collections:data};
    if(!data || typeof data !== 'object')throw new Error('Crafter API вернул некорректные данные.');
    if(key.startsWith('/collections') && !Array.isArray(data.collections))throw new Error('Crafter API не вернул массив коллекций.');
    const value = {ok:true, data, updated_at: new Date().toISOString()};`);
change("try {return json(res,200,await fetchData(request.key,request.ttl));}\n    catch(error) {return json(res,error.status || 502,{ok:false,error:error.message || 'Ошибка соединения с Crafter.'});}", `try {return json(res,200,await fetchData(request.key,request.ttl));}
    catch(error) {
      console.error('[Crafter API] request failed:', request.key, error.name || '', error.message || '', error.cause?.code || '');
      return json(res,error.status || 502,{ok:false,error:error.message || 'Ошибка соединения с Crafter.'});
    }`);
change("console.error(`Crafter API verification failed: ${error.message}`);", "console.error(`Crafter API verification failed: ${error.name}: ${error.message}; cause=${error.cause?.code || ''}`);");
fs.writeFileSync(serverPath,s,'utf8');
console.log('Crafter API compatibility patch applied');
