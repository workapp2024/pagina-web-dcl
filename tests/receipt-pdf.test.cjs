const {test}=require('node:test'),assert=require('node:assert/strict'),load=require('./load-ts.cjs');
const {receiptPdfFilename}=load('lib/receipt-pdf.tsx',{'@/components/admin/OrderReceipt':{OrderReceipt:()=>null}});
test('PDF filenames accept only original commercial numbering',()=>{assert.equal(receiptPdfFilename('MW-000007'),'DCL-Comprobante-MW-000007.pdf');assert.equal(receiptPdfFilename('DCL-000123'),'DCL-Comprobante-DCL-000123.pdf');assert.throws(()=>receiptPdfFilename('../secret'));});
const styles=new Proxy({},{get:(_,k)=>k==='__esModule'?false:k});
function harness({navigator={},failure=false,bodyNumber='MW-000007'}={}){
 const states=[],refs=[];let cursor=0,rc=0,generations=0,fetches=0,downloads=0;const shares=[];
 const file={name:'DCL-Comprobante-MW-000007.pdf',type:'application/pdf'};
 const React={useState(initial){const i=cursor++;if(!(i in states))states[i]=initial;return [states[i],v=>states[i]=v];},useRef(initial){const i=rc++;return refs[i]??=( {current:initial} );}};
 const globals={navigator:{share:async data=>shares.push(data),canShare:()=>true,...navigator},fetch:async()=>{fetches++;return Response.json({status:'ok',receipt:{orderNumber:bodyNumber}});}};
 const {ReceiptShareButton}=load('components/admin/ReceiptShareButton.tsx',{'@/app/admin/pedidos/[orderNumber]/comprobante/comprobante.module.css':styles,react:React,'@/lib/receipt-pdf':{createReceiptPdf:async()=>{generations++;if(failure)throw Error('generation');return file;},downloadReceiptPdf:()=>downloads++}},globals);
 const render=()=>{cursor=0;rc=0;return ReceiptShareButton({receipt:{orderNumber:'MW-000007'},source:'/private-receipt'});};
 const nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):tree&&typeof tree==='object'?[tree,...nodes(tree.props?.children)]:[];
 const click=async label=>{const button=nodes(render()).find(n=>n.type==='button'&&n.props.children===label);button.props.onClick();await new Promise(r=>setImmediate(r));};
 const clickTwice=async()=>{const handler=nodes(render()).find(n=>n.type==='button'&&n.props.children==='Compartir comprobante').props.onClick;handler();handler();await new Promise(r=>setImmediate(r));};
 return {click,clickTwice,render,states,shares,file,get generations(){return generations;},get fetches(){return fetches;},get downloads(){return downloads;}};
}
test('file sharing sends the visual PDF, with no text or admin link, and never claims delivery',async()=>{const h=harness();await h.click('Compartir comprobante');assert.equal(h.generations,1);assert.equal(h.fetches,1);assert.equal(h.shares[0].files[0],h.file);assert.equal(h.shares[0].text,undefined);assert.equal(h.shares[0].url,undefined);assert.equal(h.states[0],'');});
test('double tap cannot generate or share the receipt twice',async()=>{const h=harness();await h.clickTwice();assert.equal(h.generations,1);assert.equal(h.fetches,1);assert.equal(h.shares.length,1);});
test('unsupported phones offer download of the prepared file',async()=>{const h=harness({navigator:{canShare:()=>false}});await h.click('Compartir comprobante');assert.match(h.states[0],/Descargar PDF/);await h.click('Descargar PDF');assert.equal(h.downloads,1);assert.equal(h.generations,1);assert.equal(h.shares.length,0);});
test('expired user gesture retains PDF for a second tap instead of silently failing',async()=>{const activation={isActive:false};const h=harness({navigator:{userActivation:activation}});await h.click('Compartir comprobante');assert.match(h.states[0],/PDF listo/);assert.equal(h.shares.length,0);activation.isActive=true;await h.click('Compartir comprobante');assert.equal(h.generations,1);assert.equal(h.shares.length,1);});
test('cancellation is quiet; generation errors and changed receipt cannot share',async()=>{const h=harness({navigator:{share:async()=>{const e=Error('cancel');e.name='AbortError';throw e;}}});await h.click('Compartir comprobante');assert.equal(h.states[0],'');for(const options of [{failure:true},{bodyNumber:'MW-000008'}]){const broken=harness(options);await broken.click('Compartir comprobante');assert.match(broken.states[0],/No se pudo preparar/);assert.equal(broken.shares.length,0);}});
test('both fresh-data endpoints authenticate before any receipt read and prevent caching',async()=>{
 for(const [path,authName,loaderName,param] of [['app/api/admin/orders/[orderNumber]/receipt/route.ts','isAdminAuthenticated','getOrderReceipt','orderNumber'],['app/api/admin/wholesale-orders/[id]/receipt/route.ts','getAdminIdentity','getWholesaleReceipt','id']]){
 let reads=0;const mocks={'@/lib/admin-auth':{[authName]:async()=>authName==='getAdminIdentity'?{role:'VENDEDOR'}:false},[loaderName==='getOrderReceipt'?'@/lib/store/order-receipt':'@/lib/store/wholesale-receipt']:{[loaderName]:async()=>{reads++;return {status:'ok',receipt:{orderNumber:'MW-000007'}};}}};
 mocks['@/lib/receipt-identity-server']={withReceiptIdentity:async result=>result};
 let route=load(path,mocks);const props={params:Promise.resolve({[param]:'number'})};assert.equal((await route.GET(new Request('https://local.invalid'),props)).status,401);assert.equal(reads,0);
 mocks['@/lib/admin-auth'][authName]=async()=>authName==='getAdminIdentity'?{role:'ADMIN'}:true;route=load(path,mocks);const response=await route.GET(new Request('https://local.invalid'),props);assert.equal(response.status,200);assert.match(response.headers.get('cache-control'),/no-store/);assert.equal(reads,1);
 }
});
