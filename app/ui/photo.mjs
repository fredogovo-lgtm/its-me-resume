import {inspectPhotoSource,validatePhoto,photoCrop,MAX_PHOTO_DATA_URL,MAX_PHOTO_SOURCE_BYTES} from '../core/photo.mjs';
import {escape,clone} from './helpers.mjs';
import {saveLibraryForm} from './library-navigation.mjs';
import {userMessage} from './user-message.mjs';
export {paintPhoto} from './photo-view.mjs';
import {paintPhoto} from './photo-view.mjs';
export async function preparePhotoFile(file){
  if(!file || !Number.isFinite(file.size) || file.size<1 || file.size>MAX_PHOTO_SOURCE_BYTES)throw new Error('请选择10MB以内的JPG或PNG照片。');
  const bytes=new Uint8Array(await file.arrayBuffer());const meta=inspectPhotoSource(bytes);let image;
  try{image=await createImageBitmap(new Blob([bytes],{type:meta.type}),{imageOrientation:'from-image'});}catch{throw new Error('图片无法解码，请重新选择JPG或PNG照片。');}
  try{let edge=720,dataUrl,width,height;for(let attempt=0;attempt<7;attempt++){const scale=Math.min(1,edge/Math.max(image.width,image.height));width=Math.max(1,Math.round(image.width*scale));height=Math.max(1,Math.round(image.height*scale));const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;const context=canvas.getContext('2d');context.fillStyle='#fff';context.fillRect(0,0,width,height);context.drawImage(image,0,0,width,height);for(let quality=.86;quality>=.36;quality-=.1){dataUrl=canvas.toDataURL('image/jpeg',quality);if(dataUrl.length<=MAX_PHOTO_DATA_URL){const photo={id:crypto.randomUUID(),name:file.name.slice(0,240),dataUrl,width,height,updatedAt:new Date().toISOString(),crop:{x:50,y:50,zoom:1,shape:'rect'}};validatePhoto(photo);return photo;}}edge=Math.round(edge*.75);}throw new Error('照片压缩后仍过大，请选择较小图片。');}finally{image.close();}
}
export function showPhotoCrop(ctx,photo,onSave){
  let draft=clone(photo);const crop=photoCrop(draft);draft.crop=crop;
  ctx.modal('调整个人照片','拖动滑块调整取景；只保存当前操作位置的照片设置。','<form id="photo-crop-form"><div class="photo-crop-preview personal-photo-frame"></div><div class="photo-crop-controls">'+[['x','水平位置',0,100,1],['y','垂直位置',0,100,1],['zoom','放大',1,3,.05]].map(([key,label,min,max,step])=>'<label>'+label+'<input type="range" name="'+key+'" min="'+min+'" max="'+max+'" step="'+step+'" value="'+crop[key]+'"></label>').join('')+'<label>形状<select name="shape"><option value="rect" '+(crop.shape==='rect'?'selected':'')+'>圆角方形</option><option value="round" '+(crop.shape==='round'?'selected':'')+'>圆形</option></select></label></div><div class="modal-actions"><button type="button" class="button secondary" data-photo-reset>重置取景</button><button class="button primary" type="submit">保存照片设置</button></div></form>',root=>{
    const form=root.querySelector('form'),preview=root.querySelector('.photo-crop-preview');const refresh=()=>{for(const key of ['x','y','zoom'])draft.crop[key]=Number(form.elements[key].value);draft.crop.shape=form.elements.shape.value;paintPhoto(preview,draft);};form.oninput=refresh;root.querySelector('[data-photo-reset]').onclick=()=>{Object.assign(draft.crop,{x:50,y:50,zoom:1,shape:'rect'});for(const key of ['x','y','zoom','shape'])form.elements[key].value=draft.crop[key];refresh();};form.onsubmit=async event=>{event.preventDefault();const submit=form.querySelector('[type="submit"]');submit.disabled=true;try{draft.updatedAt=new Date().toISOString();validatePhoto(draft);await onSave(draft);ctx.closeModal();}catch(error){ctx.notify(error.message,true);submit.disabled=false;}};refresh();
  });
}
export function mountLibraryPhoto(ctx,host){
  if(!host)return;const photo=ctx.state.library.person.photo;
  host.className='library-personal-photo';host.innerHTML='<div class="personal-photo-frame library-photo-thumb">'+(!photo?'<span>个人照片</span>':'')+'</div><div><strong>个人图片 <span class="tag neutral">可选</span></strong><p>保存证件照或个人头像，制作简历时按需勾选。仅在本机处理。</p><div class="button-group"><label class="button secondary photo-upload-label">'+(photo?'更换照片':'添加照片')+'<input id="personal-photo-file" type="file" accept="image/jpeg,image/png,.jpg,.jpeg,.png" aria-label="选择个人照片"></label>'+(photo?'<button type="button" class="button quiet" data-photo-crop>裁剪与形状</button><button type="button" class="button quiet danger" data-photo-remove>移除</button>':'')+'</div><small>JPG / PNG，最多10MB；会自动缩小保存，不改变原图片文件。</small></div>';
  if(photo)paintPhoto(host.querySelector('.personal-photo-frame'),photo);
  const save=async value=>{const next=clone(ctx.state.library);if(value)next.person.photo=value;else delete next.person.photo;await ctx.saveLibrary(next);};
  // The photo action owns this save; optional wording review belongs to explicit Save.
  const ready=async()=>!ctx.ui.dirtyLibrary||await saveLibraryForm(ctx,{offerAi:false});
  host.querySelector('input').onchange=async event=>{const input=event.currentTarget,file=input.files[0];if(!file)return;try{const result=await preparePhotoFile(file);if(!await ready())return;await save(result);ctx.notify('个人照片已保存在本机');}catch(error){ctx.notify(error.message,true);}finally{input.value='';}};
  host.querySelector('[data-photo-crop]')?.addEventListener('click',async()=>{if(await ready())showPhotoCrop(ctx,ctx.state.library.person.photo,save);});
  host.querySelector('[data-photo-remove]')?.addEventListener('click',async()=>{try{if(!await ready())return;await save(null);ctx.notify('个人照片已移除');}catch(error){ctx.notify('个人照片未能移除：'+userMessage(error)+' 请重试。',true);}});
}
