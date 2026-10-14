// Offline comparison. Input: private JSON array exported by the read-only query.
const fs=require('node:fs');
const path=require('node:path');
function body(sql,name){
  const start=sql.search(new RegExp('CREATE(?: OR REPLACE)? FUNCTION public\\.'+name+'\\s*\\(','i'));
  if(start<0)throw new Error('Missing definition: '+name);
  const fragment=sql.slice(start);
  const match=/\bAS\s+(\$[a-zA-Z_0-9]*\$)([\s\S]*?)\1/i.exec(fragment);
  if(!match)throw new Error('Unrecognized definition: '+name);
  return match[2].replace(/\r\n/g,'\n').trim();
}
const baselines={guard_order_operations:'20260920020000_order_resolution_core.sql',order_archive_block_reason:'20260920030000_order_refunded_archiving.sql',post_wholesale_financial_entry:'20261017010000_wholesale_financial_account_postings.sql'};
if(!process.argv[2])throw new Error('Provide the private exported JSON path. No database connection is made.');
const rows=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
for(const [name,file] of Object.entries(baselines)){
  const matches=rows.filter(r=>r.signature.startsWith(name+'(')||r.signature.startsWith('public.'+name+'('));
  const same=matches.length===1&&body(matches[0].definition,name)===body(fs.readFileSync(path.join(__dirname,'../../supabase/migrations',file),'utf8'),name);
  console.log(JSON.stringify({function:name,baselineBodyMatches:same,reviewRequired:!same,metadataReviewRequired:true}));
}
// Exact comparison deliberately flags formatting differences for review.
// Never applies a definition or treats missing evidence as compatible.
