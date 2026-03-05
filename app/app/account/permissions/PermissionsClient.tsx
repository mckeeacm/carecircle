"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase/browser";

type Feature = {
  key: string;
  label: string | null;
  description: string | null;
};

type Member = {
  user_id: string;
  role: string | null;
  nickname: string | null;
  is_controller: boolean | null;
};

type RolePerm = {
  role: string;
  feature_key: string;
  allowed: boolean;
};

type MemberPerm = {
  user_id: string;
  feature_key: string;
  allowed: boolean;
};

export default function PermissionsClient() {

  const supabase = useMemo(() => supabaseBrowser(), []);
  const sp = useSearchParams();

  const [pid,setPid] = useState<string>("");

  const [features,setFeatures] = useState<Feature[]>([]);
  const [members,setMembers] = useState<Member[]>([]);
  const [roles,setRoles] = useState<string[]>([]);

  const [rolePerms,setRolePerms] = useState<RolePerm[]>([]);
  const [memberPerms,setMemberPerms] = useState<MemberPerm[]>([]);

  const [isController,setIsController] = useState(false);

  const [msg,setMsg] = useState<string | null>(null);
  const [loading,setLoading] = useState(false);

  useEffect(()=>{
    const p = sp.get("pid");
    if(p) setPid(p);
  },[sp]);

  async function refresh(){

    if(!pid) return;

    setLoading(true);
    setMsg(null);

    try{

      const { data: perm } = await supabase.rpc("permissions_get",{pid});

      if(!perm) throw new Error("Permission check failed");

      setIsController(perm.is_controller === true);

      const { data: f } = await supabase
      .from("feature_keys")
      .select("key,label,description")
      .order("key");

      setFeatures(f ?? []);

      const { data: mem } = await supabase
      .from("patient_members")
      .select("user_id,role,nickname,is_controller")
      .eq("patient_id",pid);

      setMembers(mem ?? []);

      const r = Array.from(new Set((mem ?? []).map((m:any)=>m.role).filter(Boolean)));

      setRoles(r as string[]);

      const { data: rp } = await supabase
      .from("patient_role_permissions")
      .select("role,feature_key,allowed")
      .eq("patient_id",pid);

      setRolePerms(rp ?? []);

      const { data: mp } = await supabase
      .from("patient_member_permissions")
      .select("user_id,feature_key,allowed")
      .eq("patient_id",pid);

      setMemberPerms(mp ?? []);

    }
    catch(e:any){
      setMsg(e?.message ?? "Failed to load permissions");
    }
    finally{
      setLoading(false);
    }

  }

  useEffect(()=>{
    refresh();
  },[pid]);

  function roleAllowed(role:string,key:string){

    const r = rolePerms.find(x=>x.role===role && x.feature_key===key);

    return r ? r.allowed : false;

  }

  function memberOverride(uid:string,key:string){

    const m = memberPerms.find(x=>x.user_id===uid && x.feature_key===key);

    return m ? m.allowed : null;

  }

  async function setRole(role:string,key:string,val:boolean){

    const { error } = await supabase.rpc("permissions_set_role",{
      pid,
      p_role:role,
      p_feature_key:key,
      p_allowed:val
    });

    if(error) setMsg(error.message);
    else refresh();

  }

  async function setMember(uid:string,key:string,val:boolean){

    const { error } = await supabase.rpc("permissions_set_member",{
      pid,
      member_uid:uid,
      p_feature_key:key,
      p_allowed:val
    });

    if(error) setMsg(error.message);
    else refresh();

  }

  async function clearMember(uid:string,key:string){

    const { error } = await supabase.rpc("permissions_clear_member_override",{
      pid,
      member_uid:uid,
      p_feature_key:key
    });

    if(error) setMsg(error.message);
    else refresh();

  }

  return (

  <div className="cc-page">
  <div className="cc-container cc-stack">

  <div className="cc-row-between">
  <div>
  <div className="cc-kicker">CareCircle</div>
  <h1 className="cc-h1">Permissions</h1>
  </div>

  <div className="cc-row">
  <Link className="cc-btn" href="/app/hub">Hub</Link>
  <Link className="cc-btn" href="/app/account">Account</Link>
  </div>
  </div>

  {msg &&
  <div className="cc-status cc-status-error">
  <div>{msg}</div>
  </div>
  }

  <div className="cc-card cc-card-pad cc-stack">

  <div className="cc-row">

  <input
  className="cc-input"
  value={pid}
  onChange={e=>setPid(e.target.value)}
  />

  <button
  className="cc-btn"
  onClick={refresh}
  >
  {loading ? "Loading…" : "Refresh"}
  </button>

  </div>

  </div>

  {/* ROLE GRID */}

  <div className="cc-card cc-card-pad cc-stack">

  <h2 className="cc-h2">Role permissions</h2>

  <table style={{width:"100%",borderCollapse:"collapse"}}>

  <thead>
  <tr>
  <th>Feature</th>
  {roles.map(r=>
  <th key={r}>{r}</th>
  )}
  </tr>
  </thead>

  <tbody>

  {features.map(f=>

  <tr key={f.key}>

  <td>

  <div className="cc-strong">{f.label ?? f.key}</div>
  <div className="cc-small cc-subtle">{f.description}</div>

  </td>

  {roles.map(role=>{

  const allowed = roleAllowed(role,f.key);

  return(

  <td key={role+f.key}>

  <button
  className="cc-btn"
  onClick={()=>setRole(role,f.key,!allowed)}
  disabled={!isController}
  >

  {allowed ? "Allowed" : "Denied"}

  </button>

  </td>

  )

  })}

  </tr>

  )}

  </tbody>

  </table>

  </div>

  {/* MEMBER GRID */}

  <div className="cc-card cc-card-pad cc-stack">

  <h2 className="cc-h2">Member overrides</h2>

  <table style={{width:"100%",borderCollapse:"collapse"}}>

  <thead>

  <tr>

  <th>Feature</th>

  {members.map(m=>
  <th key={m.user_id}>
  {m.nickname ?? m.user_id}
  {m.is_controller ? " (controller)" : ""}
  </th>
  )}

  </tr>

  </thead>

  <tbody>

  {features.map(f=>

  <tr key={f.key}>

  <td>

  <div className="cc-strong">{f.label ?? f.key}</div>

  </td>

  {members.map(m=>{

  const ov = memberOverride(m.user_id,f.key);

  return(

  <td key={m.user_id+f.key}>

  {m.is_controller ?

  "—"

  :

  <div className="cc-row">

  <button
  className="cc-btn"
  onClick={()=>setMember(m.user_id,f.key,true)}
  disabled={!isController}
  >

  Allow

  </button>

  <button
  className="cc-btn"
  onClick={()=>setMember(m.user_id,f.key,false)}
  disabled={!isController}
  >

  Deny

  </button>

  <button
  className="cc-btn"
  onClick={()=>clearMember(m.user_id,f.key)}
  disabled={!isController}
  >

  Clear

  </button>

  </div>

  }

  </td>

  )

  })}

  </tr>

  )}

  </tbody>

  </table>

  </div>

  </div>
  </div>

  );
}