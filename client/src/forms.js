// Shared submission state for account and character forms. GPL-3.0-or-later.
export async function submitForm(form, submit) {
  if(form.getAttribute('aria-busy')==='true')return;
  const buttons=[...form.querySelectorAll('button[type="submit"],input[type="submit"]')];
  const disabled=buttons.map(button=>button.disabled);
  form.setAttribute('aria-busy','true');
  for(const button of buttons)button.disabled=true;
  const error=form.querySelector('.form-error');
  if(error)error.textContent='';
  try{return await submit();}
  finally{
    form.removeAttribute('aria-busy');
    buttons.forEach((button,index)=>button.disabled=disabled[index]);
  }
}
