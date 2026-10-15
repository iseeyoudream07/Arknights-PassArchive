export function doctorIdentity(authenticated:boolean,username:unknown){
  return authenticated&&typeof username==='string'&&/^[a-z0-9_]{3,32}$/i.test(username)
    ?`DR.${username}`:'DOCTOR';
}
