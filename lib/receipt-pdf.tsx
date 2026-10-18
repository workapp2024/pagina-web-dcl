import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { OrderReceipt } from "@/components/admin/OrderReceipt";
import type { OrderReceipt as ReceiptData } from "@/lib/store/order-receipt";

export function receiptPdfFilename(number:string){
  if(!/^(DCL|MW)-[0-9]{6,19}$/.test(number))throw Error('Invalid receipt number');
  return `DCL-Comprobante-${number}.pdf`;
}
// Reuse the existing component and styles, at a fixed A4 layout, without
// navigating the frame to any authenticated URL or sending data to a service.
export async function createReceiptPdf(receipt:ReceiptData):Promise<File>{
  const filename=receiptPdfFilename(receipt.orderNumber);
  const [{default:html2canvas},{PDFDocument}]=await Promise.all([import('html2canvas'),import('pdf-lib')]);
  const frame=document.createElement('iframe');frame.title='Preparación del comprobante';frame.setAttribute('aria-hidden','true');
  frame.style.cssText='position:fixed;left:-10000px;top:0;width:794px;height:1123px;border:0;pointer-events:none;';document.body.appendChild(frame);
  let root:ReturnType<typeof createRoot>|undefined;
  try {
    const doc=frame.contentDocument;if(!doc)throw Error('Document unavailable');
    const ready=[...document.querySelectorAll('link[rel="stylesheet"],style')].map(source=>{const node=source.cloneNode(true) as HTMLElement;doc.head.appendChild(node);return node.tagName==='LINK'?new Promise<void>((resolve,reject)=>{(node as HTMLLinkElement).onload=()=>resolve();(node as HTMLLinkElement).onerror=()=>reject(Error('Styles unavailable'));setTimeout(()=>{if((node as HTMLLinkElement).sheet)resolve();else reject(Error('Style timeout'));},10000);}):Promise.resolve();});
    doc.body.style.cssText='margin:0;background:#ffffff;color:#202124;font-family:Arial,sans-serif;';
    const host=doc.createElement('div');doc.body.appendChild(host);root=createRoot(host);flushSync(()=>root!.render(<OrderReceipt receipt={receipt}/>));
    await Promise.all(ready);await doc.fonts.ready;
    const article=host.querySelector('article');if(!article)throw Error('Receipt unavailable');
    for(const img of article.querySelectorAll('img')){await img.decode();if(!img.naturalWidth)throw Error('Logo unavailable');}
    const height=Math.ceil(article.getBoundingClientRect().height);if(height<=0||height>24000)throw Error('Receipt too large');
    // Bound canvas memory on phones; very large receipts retain native printing.
    const scale=Math.min(1.5,Math.sqrt(8_000_000/(article.getBoundingClientRect().width*height)));
    if(scale<0.75)throw Error('Receipt too large');
    const canvas=await html2canvas(article,{scale,backgroundColor:'#f0f1f3',logging:false,windowWidth:794,windowHeight:1123});
    const bounds=article.getBoundingClientRect();
    const blocks=[...article.querySelectorAll('header,tr,dl,footer')].map(el=>{const r=el.getBoundingClientRect();return {top:(r.top-bounds.top)*scale,bottom:(r.bottom-bounds.top)*scale};});
    const pdf=await PDFDocument.create();pdf.setTitle(`DCL · ${receipt.orderNumber}`);pdf.setCreator('DCL Cree LED');
    const width=595.28,margin=30,usable=width-margin*2,pageHeight=841.89,maxPixels=(pageHeight-margin*2)*canvas.width/usable;
    let start=0;
    while(start<canvas.height){
      let end=Math.min(canvas.height,Math.floor(start+maxPixels));
      const crossing=blocks.filter(b=>b.top>start+1&&b.top<end&&b.bottom>end&&b.bottom-b.top<=maxPixels);
      if(crossing.length)end=Math.floor(Math.min(...crossing.map(b=>b.top)));
      // Canvas text rounding can differ slightly from DOM geometry. Move the
      // cut to a blank raster band as well, so glyphs cannot straddle pages.
      if(end<canvas.height){
        const context=canvas.getContext('2d');if(!context)throw Error('Canvas unavailable');
        const lower=Math.max(start+1,end-120),pixels=context.getImageData(0,lower,canvas.width,Math.min(canvas.height-lower,end-lower+3));
        const blank=(y:number)=>{for(let x=24;x<canvas.width-24;x++){const i=((y-lower)*canvas.width+x)*4;if(pixels.data[i]<150||pixels.data[i+1]<150||pixels.data[i+2]<150)return false;}return true;};
        for(let y=end-2;y>lower+1;y--)if(blank(y-1)&&blank(y)&&blank(y+1)){end=y;break;}
      }
      if(end<=start)throw Error('Invalid page break');
      const tile=document.createElement('canvas');tile.width=canvas.width;tile.height=end-start;
      const context=tile.getContext('2d');if(!context)throw Error('Canvas unavailable');context.drawImage(canvas,0,start,canvas.width,end-start,0,0,canvas.width,end-start);
      const image=await pdf.embedPng(tile.toDataURL('image/png')),page=pdf.addPage([width,pageHeight]),imageHeight=(end-start)*usable/canvas.width;
      page.drawImage(image,{x:margin,y:pageHeight-margin-imageHeight,width:usable,height:imageHeight});tile.width=0;tile.height=0;start=end;
    }
    const bytes=await pdf.save();canvas.width=0;canvas.height=0;
    return new File([new Uint8Array(bytes)],filename,{type:'application/pdf'});
  }finally{root?.unmount();frame.remove();}
}
export function downloadReceiptPdf(file:File){
  const url=URL.createObjectURL(file),link=document.createElement('a');link.href=url;link.download=file.name;document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
}
