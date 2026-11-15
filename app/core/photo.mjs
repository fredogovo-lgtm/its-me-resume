export const MAX_PHOTO_SOURCE_BYTES = 10 * 1024 * 1024;
export const MAX_PHOTO_DATA_URL = 65000;
const fail = message => { throw new Error('个人照片：' + message); };
const dims = (width,height) => { if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>12000||height>12000||width*height>20000000)fail('图片尺寸过大或无效，请选择不超过2000万像素的照片。');return{width,height}; };
export function inspectPhotoSource(bytes) {
  if(!(bytes instanceof Uint8Array)||!bytes.length||bytes.length>MAX_PHOTO_SOURCE_BYTES)fail('请选择10MB以内的JPG或PNG图片。');
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  if(bytes.length>=33&&[137,80,78,71,13,10,26,10].every((n,i)=>bytes[i]===n)){
    if(view.getUint32(8)!==13||view.getUint32(12)!==0x49484452)fail('PNG文件头无效。');return{type:'image/png',...dims(view.getUint32(16),view.getUint32(20))};
  }
  if(bytes[0]===255&&bytes[1]===216){
    let i=2;while(i+3<bytes.length){if(bytes[i++]!==255)fail('JPEG文件结构无效。');while(bytes[i]===255)i++;const marker=bytes[i++];if(marker===217||marker===218)break;if(marker===1||marker>=208&&marker<=215)continue;if(i+2>bytes.length)break;const length=view.getUint16(i);if(length<2||i+length>bytes.length)fail('JPEG文件不完整。');if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)){if(length<8)fail('JPEG尺寸无效。');return{type:'image/jpeg',...dims(view.getUint16(i+5),view.getUint16(i+3))};}i+=length;}
  }
  fail('仅支持有效的JPG、JPEG和PNG图片。');
}
export function validatePhoto(photo,path='photo') {
  if(!photo||typeof photo!=='object'||Array.isArray(photo))fail(path+'无效。');
  if(typeof photo.id!=='string'||!/^[a-zA-Z0-9_-]{1,128}$/u.test(photo.id))fail('编号无效。');
  if(typeof photo.name!=='string'||photo.name.length>240||/[\u0000-\u001f]/u.test(photo.name))fail('名称无效。');
  if(typeof photo.dataUrl!=='string'||photo.dataUrl.length>MAX_PHOTO_DATA_URL||!/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/u.test(photo.dataUrl))fail('图片内容无效或过大。');
  let bytes;try{bytes=Uint8Array.from(atob(photo.dataUrl.slice(photo.dataUrl.indexOf(',')+1)),c=>c.charCodeAt(0));}catch{fail('图片编码无效。');}
  if(bytes.length<4||bytes[0]!==255||bytes[1]!==216||bytes.at(-2)!==255||bytes.at(-1)!==217)fail('JPEG内容无效。');
  dims(photo.width,photo.height);if(photo.width>1200||photo.height>1200)fail('保存的照片尺寸过大。');
  if(typeof photo.updatedAt!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(photo.updatedAt)||!Number.isFinite(Date.parse(photo.updatedAt)))fail('时间无效。');
  if(photo.crop!==undefined){const c=photo.crop;if(!c||!['x','y','zoom'].every(k=>Number.isFinite(c[k]))||c.x<0||c.x>100||c.y<0||c.y>100||c.zoom<1||c.zoom>3||!['rect','round'].includes(c.shape))fail('裁剪设置无效。');}
  return true;
}
export const photoCrop = photo => ({x:50,y:50,zoom:1,shape:'rect',...photo.crop});
export function makePhotoBlock(photo) {
  validatePhoto(photo);return{id:crypto.randomUUID(),sourceId:photo.id,kind:'photo',category:'photo',period:'',tags:[],zh:{title:'个人照片',subtitle:'',body:''},en:{title:'Portrait',subtitle:'',body:''},stale:{zh:false,en:false},photo:structuredClone(photo),x:166,y:16,width:28,height:36,page:0,fontSize:10.5,color:'#253746',background:'transparent',fixedHeight:true,locked:false,column:'main'};
}
