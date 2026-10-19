export const RECEIPT_LOGO_ORIGINAL_MAX_BYTES = 5 * 1024 * 1024;
export const RECEIPT_LOGO_UPLOAD_MAX_BYTES = 2 * 1024 * 1024;

// Check dimensions before decoding so a small compressed file cannot allocate an
// unbounded bitmap on a phone. The server independently validates the result.
export function receiptLogoDimensions(bytes: Uint8Array, mime: string) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let width = 0, height = 0, format = "";
  if (bytes.length >= 33 && [137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v)) {
    format = "image/png"; width = view.getUint32(16); height = view.getUint32(20);
    for (let i=8;i+12<=bytes.length;) {
      const length=view.getUint32(i); if (length>bytes.length-i-12) throw Error("El PNG está incompleto.");
      if (String.fromCharCode(...bytes.subarray(i+4,i+8)) === "acTL") throw Error("Elegí un PNG estático, sin animación.");
      i+=length+12;
    }
  } else if (bytes.length >= 4 && bytes[0]===255 && bytes[1]===216) {
    format="image/jpeg";
    for(let i=2;i+4<bytes.length;) {
      if(bytes[i++]!==255) throw Error("El JPG no es válido.");
      while(bytes[i]===255)i++;
      const marker=bytes[i++];if(marker===217||marker===218)break;
      if(marker===1||(marker>=208&&marker<=215))continue;
      if(i+2>bytes.length)break;const length=view.getUint16(i);
      if(length<2||i+length>bytes.length)throw Error("El JPG está incompleto.");
      if([192,193,194].includes(marker)){if(length<8)break;height=view.getUint16(i+3);width=view.getUint16(i+5);break;}i+=length;
    }
  }
  if (!format || (mime && mime!==format) || !width || !height) throw Error("Elegí una imagen PNG o JPG válida.");
  if(width>4096||height>4096||width*height>16_777_216)throw Error("La imagen es demasiado grande: exportala con hasta 4096 píxeles por lado.");
  return {width,height,format};
}

export async function prepareReceiptLogo(file: File): Promise<{ file: File; width: number; height: number; transparent: boolean }> {
  if(!file.size||file.size>RECEIPT_LOGO_ORIGINAL_MAX_BYTES)throw Error("La imagen supera el límite de 5 MB. Exportala con menor tamaño desde Canva.");
  const bytes=new Uint8Array(await file.arrayBuffer());receiptLogoDimensions(bytes,file.type);
  const url=URL.createObjectURL(file),image=new Image();image.src=url;
  const canvas=document.createElement("canvas");
  try {
    try { await image.decode(); } catch { throw Error("No se pudo abrir la imagen. Volvé a exportarla como PNG o JPG."); }
    let size=Math.min(1600,Math.max(image.naturalWidth,image.naturalHeight));
    while(true){
      const ratio=Math.min(1,size/Math.max(image.naturalWidth,image.naturalHeight));
      canvas.width=Math.max(1,Math.round(image.naturalWidth*ratio));canvas.height=Math.max(1,Math.round(image.naturalHeight*ratio));
      const ctx=canvas.getContext("2d",{willReadFrequently:true});if(!ctx)throw Error("No se pudo preparar la imagen en este navegador.");
      ctx.clearRect(0,0,canvas.width,canvas.height);ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality="high";ctx.drawImage(image,0,0,canvas.width,canvas.height);
      const blob=await new Promise<Blob|null>(resolve=>canvas.toBlob(resolve,"image/png"));
      if(!blob)throw Error("No se pudo preparar la imagen. Volvé a seleccionarla.");
      if(blob.size<=RECEIPT_LOGO_UPLOAD_MAX_BYTES){
        const pixels=ctx.getImageData(0,0,canvas.width,canvas.height).data;let transparent=false;
        for(let i=3;i<pixels.length;i+=4)if(pixels[i]<255){transparent=true;break;}
        return {file:new File([blob],"DCL-logo.png",{type:"image/png"}),width:canvas.width,height:canvas.height,transparent};
      }
      if(size<=640)throw Error("No se pudo reducir la imagen. Exportala con menor tamaño desde Canva.");
      size=Math.max(640,Math.floor(size*.8));
    }
  } finally { URL.revokeObjectURL(url);canvas.width=0;canvas.height=0;image.src=""; }
}
