import WebSocket from 'ws';
const ws=new WebSocket('ws://127.0.0.1:8790'); const TK=process.argv[2];
const t=setTimeout(()=>{console.log('TIMEOUT');process.exit(2)},220000);
ws.on('open',()=>ws.send(JSON.stringify({type:'auth',token:TK})));
ws.on('message',d=>{const m=JSON.parse(d);
 if(m.type==='permission_request')return ws.send(JSON.stringify({type:'permission_response',reqId:m.reqId,allow:true}));
 if(m.type==='auth_ok')ws.send(JSON.stringify({type:'send',cwd:'/root/cc-bridge-workspace',text:'用 tts 以 rei-gsv 念“重新测试一遍”，再用 genimage 画一张1024x1024的樱花。给我音频和图片路径。'}));
 if(m.type==='media')console.log('>>> MEDIA:',m.kind,m.url.slice(0,72));
 if(m.type==='turn_error'){console.log('ERR',m.message);process.exit(1);}
 if(m.type==='turn_end'){console.log('turn_end | in='+m.inTokens+' cached='+m.cachedTokens+' out='+m.outTokens+' '+(m.durationMs/1000).toFixed(1)+'s');clearTimeout(t);process.exit(0);}
});
ws.on('error',e=>{console.log('ERR',e.message);process.exit(1)});
