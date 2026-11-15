import {createHash} from 'node:crypto';
import path from 'node:path';
export function makeAppInfo(version,dataDirectory){
 const resolved=path.resolve(dataDirectory),identity=process.platform==='win32'?resolved.toLowerCase():resolved;
 return {version,draftScope:createHash('sha256').update(identity).digest('hex').slice(0,16)};
}
