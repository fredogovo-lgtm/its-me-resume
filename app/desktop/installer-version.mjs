// Read only, bounded PE version resources. This identifies the declared local
// product/version; it does not authenticate a publisher or execute the file.
// Format: https://learn.microsoft.com/windows/win32/debug/pe-format
// https://learn.microsoft.com/windows/win32/menurc/vs-versioninfo
const MAX_HEADER=1024*1024,MAX_RESOURCES=4*1024*1024,MAX_LEAVES=64;
const invalid=()=>{throw Error('安装包版本资源缺失、损坏或不受支持，请重新获取完整安装包。');};
const align4=n=>Math.ceil(n/4)*4;
const range=(buffer,start,size)=>{if(!Number.isSafeInteger(start)||!Number.isSafeInteger(size)||start<0||size<0||start+size>buffer.length)invalid();};
async function readRange(file,start,size,fileSize){if(!Number.isSafeInteger(start)||!Number.isSafeInteger(size)||start<0||size<1||start+size>fileSize||size>MAX_RESOURCES)invalid();const out=Buffer.alloc(size);let read=0;while(read<size){const result=await file.read(out,read,size-read,start+read);if(!result.bytesRead)invalid();read+=result.bytesRead;}return out;}
const normalizeStringVersion=value=>{if(typeof value!=='string'||!/^\d{1,5}\.\d{1,5}\.\d{1,5}(?:\.0)?$/u.test(value))invalid();const parts=value.split('.').map(Number);if(parts.some((n,i)=>n>65535||(String(n)!==value.split('.')[i])))invalid();return parts.slice(0,3).join('.');};
function parseVersionBlob(bytes){
 let nodes=0;
 function parseNode(start,limit,depth=0){
  if(++nodes>2048||depth>5)invalid();range(bytes,start,6);const length=bytes.readUInt16LE(start),valueLength=bytes.readUInt16LE(start+2),type=bytes.readUInt16LE(start+4),end=start+length;if(length<8||end>limit||type>1)invalid();
  let keyEnd=start+6;while(keyEnd+2<=end&&bytes.readUInt16LE(keyEnd)!==0){keyEnd+=2;if(keyEnd-(start+6)>512)invalid();}if(keyEnd+2>end)invalid();const key=bytes.toString('utf16le',start+6,keyEnd),valueStart=align4(keyEnd+2),valueBytes=valueLength*(type===1?2:1);if(valueStart+valueBytes>end)invalid();
  const value=bytes.subarray(valueStart,valueStart+valueBytes),children=[];let offset=align4(valueStart+valueBytes);const names=new Set();while(offset<end){if(end-offset<6){if(bytes.subarray(offset,end).some(n=>n!==0))invalid();break;}const child=parseNode(offset,end,depth+1);if(names.has(child.key))invalid();names.add(child.key);children.push(child);offset=align4(child.end);}return {key,type,value,children,end};
 }
 const root=parseNode(0,bytes.length);if(root.key!=='VS_VERSION_INFO'||root.type!==0||root.value.length!==52||bytes.subarray(root.end).some(n=>n!==0))invalid();
 const fixed=root.value;if(fixed.readUInt32LE(0)!==0xfeef04bd||![0,0x10000].includes(fixed.readUInt32LE(4))||fixed.readUInt32LE(36)!==1)invalid();
 const parts=offset=>{const ms=fixed.readUInt32LE(offset),ls=fixed.readUInt32LE(offset+4);return[ms>>>16,ms&65535,ls>>>16,ls&65535];},fileParts=parts(8),productParts=parts(16);if(fileParts[3]!==0||fileParts.some((v,i)=>v!==productParts[i]))throw Error('安装包文件版本与产品版本不一致，请重新获取安装包。');const version=fileParts.slice(0,3).join('.');
 const strings=root.children.find(n=>n.key==='StringFileInfo');if(!strings||strings.value.length||!strings.children.length)invalid();
 for(const table of strings.children){if(table.value.length||! /^[0-9a-f]{8}$/iu.test(table.key)||!table.children.length)invalid();const values=new Map();for(const item of table.children){if(item.type!==1||item.children.length||item.value.length<2||item.value.readUInt16LE(item.value.length-2)!==0)invalid();const value=item.value.toString('utf16le',0,item.value.length-2);if(value.includes('\0'))invalid();values.set(item.key,value);}
  if(!values.has('ProductName'))invalid();if(values.get('ProductName')!=='ITS ME')throw Error('该安装包的产品不是 ITS ME，请选择作者提供的 ITS ME 安装包。');if(normalizeStringVersion(values.get('ProductVersion'))!==version||normalizeStringVersion(values.get('FileVersion'))!==version)throw Error('安装包多语言版本资源不一致，请重新获取安装包。');
 }
 return {productName:'ITS ME',version};
}
export async function readInstallerVersion(file,fileSize){
 const dos=await readRange(file,0,64,fileSize);if(dos.toString('ascii',0,2)!=='MZ')invalid();const pe=dos.readUInt32LE(60);if(pe<64||pe>MAX_HEADER)invalid();const coff=await readRange(file,pe,24,fileSize);if(coff.toString('binary',0,4)!=='PE\0\0'||![0x14c,0x8664].includes(coff.readUInt16LE(4)))invalid();const count=coff.readUInt16LE(6),optionalSize=coff.readUInt16LE(20);if(count<1||count>96||optionalSize<112||optionalSize>4096)invalid();
 const optional=await readRange(file,pe+24,optionalSize,fileSize),magic=optional.readUInt16LE(0),directoryOffset=magic===0x10b?96:magic===0x20b?112:0;if((coff.readUInt16LE(4)===0x14c)!==(magic===0x10b))invalid();if(!directoryOffset||optional.length<directoryOffset+24||optional.readUInt32LE(directoryOffset-4)<3)invalid();const resourceRva=optional.readUInt32LE(directoryOffset+16),resourceSize=optional.readUInt32LE(directoryOffset+20);if(!resourceRva||resourceSize<16||resourceSize>MAX_RESOURCES)invalid();
 const table=await readRange(file,pe+24+optionalSize,count*40,fileSize),sections=[];for(let i=0;i<count;i++){const at=i*40,virtualSize=table.readUInt32LE(at+8),rva=table.readUInt32LE(at+12),size=table.readUInt32LE(at+16),raw=table.readUInt32LE(at+20);if(raw+size>fileSize||rva+Math.max(size,virtualSize)>0x100000000)invalid();sections.push({rva,size,raw,virtualSize});}
 const matches=sections.filter(s=>resourceRva>=s.rva&&resourceRva+resourceSize<=s.rva+s.size);if(matches.length!==1||resourceRva+resourceSize>0x100000000)invalid();const section=matches[0];if(sections.some(s=>s!==section&&resourceRva<s.rva+Math.max(s.size,s.virtualSize)&&s.rva<resourceRva+resourceSize))invalid();const data=await readRange(file,section.raw+resourceRva-section.rva,resourceSize,fileSize),visited=new Set(),versions=[];
 function entries(offset){if(visited.has(offset))invalid();visited.add(offset);range(data,offset,16);const count=data.readUInt16LE(offset+12)+data.readUInt16LE(offset+14);if(count<1||count>2048)invalid();range(data,offset+16,count*8);const names=new Set(),out=[];for(let i=0;i<count;i++){const at=offset+16+i*8,name=data.readUInt32LE(at),target=data.readUInt32LE(at+4);let identity=String(name);if(name&0x80000000){const address=name&0x7fffffff;range(data,address,2);const length=data.readUInt16LE(address);if(!length||length>4096)invalid();range(data,address+2,length*2);identity='name:'+data.toString('utf16le',address+2,address+2+length*2);}if(names.has(identity))invalid();names.add(identity);out.push({name,target});}return out;}
 function walk(offset,depth){if(depth>2)invalid();for(const entry of entries(offset)){if(entry.target&0x80000000){if(depth>=2)invalid();walk(entry.target&0x7fffffff,depth+1);}else{if(depth!==2||versions.length>=MAX_LEAVES)invalid();range(data,entry.target,16);const rva=data.readUInt32LE(entry.target),size=data.readUInt32LE(entry.target+4);if(rva<resourceRva||size<1||size>65535||rva+size>resourceRva+resourceSize)invalid();versions.push(parseVersionBlob(data.subarray(rva-resourceRva,rva-resourceRva+size)));}}}
 const types=entries(0).filter(entry=>entry.name===16);if(types.length!==1||!(types[0].target&0x80000000))invalid();walk(types[0].target&0x7fffffff,1);if(!versions.length)invalid();const result=versions[0];if(versions.some(v=>v.version!==result.version||v.productName!==result.productName))throw Error('安装包多语言版本资源不一致，请重新获取安装包。');return result;
}


