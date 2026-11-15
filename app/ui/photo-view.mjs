import {photoCrop} from '../core/photo.mjs';
export function paintPhoto(container,photo){
  container.replaceChildren();if(!photo)return;const crop=photoCrop(photo),image=document.createElement('img');image.src=photo.dataUrl;image.alt='个人照片';image.draggable=false;image.style.objectPosition=crop.x+'% '+crop.y+'%';image.style.transformOrigin=crop.x+'% '+crop.y+'%';image.style.transform='scale('+crop.zoom+')';container.classList.toggle('photo-round',crop.shape==='round');container.append(image);
}
