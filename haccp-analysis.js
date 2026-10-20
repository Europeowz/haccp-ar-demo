import {setupHaccpLink} from './haccp-link.js?v=12';
const mount=document.getElementById('haccp-assurance');
if(mount){
  const ui=setupHaccpLink({mount,mode:'inline',onProcess:id=>{
    const button=document.querySelector(`#process-strip button[data-process="${id}"]`);
    if(button)button.click();
    else window.dispatchEvent(new CustomEvent('haccp-request-process',{detail:{id}}));
  }});
  const params=new URLSearchParams(location.search);
  if((params.get('case')||'water')!=='water')mount.hidden=true;
  else ui.setProcess(params.get('process')||'p01');
  window.addEventListener('haccp-process-change',event=>{if(event.detail?.id)ui.setProcess(event.detail.id);});
}
