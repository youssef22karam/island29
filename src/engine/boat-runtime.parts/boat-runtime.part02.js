    const dx=-Math.sin(boat.heading)*stepLen,dz=-Math.cos(boat.heading)*stepLen;
    const nx=boat.position.x+dx,nz=boat.position.z+dz;
    const curDepth=field.waterAt(boat.position.x,boat.position.z).depth;
    const nextDepth=field.waterAt(nx,nz).depth;
    if(nextDepth>minDraft||(nextDepth>curDepth&&nextDepth>.18)){
      boat.position.x=nx;boat.position.z=nz;
    }else{
      // Multi-angle curved bank gliding so the hull slides effortlessly along river bends & sandbars
      let moved=false;
      for(const ang of [.38,-.38,.78,-.78,1.18,-1.18]){
        const ca=Math.cos(ang),sa=Math.sin(ang);
        const scale=Math.max(.35,Math.cos(ang));
        const tx=boat.position.x+(dx*ca-dz*sa)*scale;
        const tz=boat.position.z+(dx*sa+dz*ca)*scale;
        const td=field.waterAt(tx,tz).depth;
        if(td>minDraft||(td>curDepth+.05&&td>.2)){
          boat.position.x=tx;boat.position.z=tz;
          boat.heading-=ang*Math.sign(boat.speed||1)*Math.min(1,dt*3.2);
          boat.power*=Math.exp(-dt*1.1);
          moved=true;
          break;
        }
      }
      if(!moved){
        // Gently nudge toward deeper water along local bathymetry gradient
        const dP=field.waterAt(boat.position.x+4,boat.position.z).depth-field.waterAt(boat.position.x-4,boat.position.z).depth;
        const dQ=field.waterAt(boat.position.x,boat.position.z+4).depth-field.waterAt(boat.position.x,boat.position.z-4).depth;
        const gL=Math.hypot(dP,dQ);
        if(gL>.02){
          const push=Math.max(.35,Math.abs(boat.speed)*dt*.65);
          boat.position.x+=(dP/gL)*push;
          boat.position.z+=(dQ/gL)*push;
        }
        boat.speed*=Math.exp(-dt*3.5);
        boat.power*=Math.exp(-dt*3.5);
      }
    }
    floatStep(dt,t);boat.updateMatrixWorld(true);KIT.animate(dt,boat.power,ST.lean);
    nightLights();wakeStep(dt);sprayStep(dt);boatLight();
    original.uSeaWake.value=wkA.texture;original.uSeaWakeBox.value.copy(WU.uWi.value);
    original.uSeaWakeStrength.value=WU.uWk.value;
    state.x=lastX=boat.position.x;state.z=lastZ=boat.position.z;state.heading=-boat.heading-Math.PI/2;state.speed=boat.speed;
    if(!options.getDrag()&&document.pointerLockElement!==options.el){const look=options.getYaw(),angle=((state.heading-look+Math.PI*3)%(Math.PI*2))-Math.PI;options.setYaw(look+angle*(1-Math.exp(-dt*1.4)));}
    options.onStats(Math.abs(boat.speed)*1.944,((state.heading*180/Math.PI+90)%360+360)%360);
    cameras(dt,t);
  }
  function idle(dt,t){
    if(!hasSailed)return;idleTime+=dt;
    const speed=boat.speed,power=boat.power;boat.speed=boat.power=0;
    ST.evt=0;ST.wash=0;ST.sprayE=0;wakeStep(Math.min(dt,.05));sprayStep(Math.min(dt,.05));
    boat.speed=speed;boat.power=power;
    original.uSeaWake.value=wkA.texture;original.uSeaWakeBox.value.copy(WU.uWi.value);original.uBLk.value=0;
    if(idleTime>25){hasSailed=false;sPts.visible=false;original.uSeaWakeStrength.value=0;}
  }
  return {update,idle,setCamera(value){mode=value;cameraReady=false;camera.fov=value==='Bridge'?75:58;camera.updateProjectionMatrix();},
    setThrottle(value){throttle=clamp(value,-3,8);},right:rightBoat,
    telemetry(){return {throttle,speed:boat.speed||0,power:boat.power||0,roll:ST.roll,pitch:ST.pitch,capsized:ST.cap!==0,camera:mode,time:realTime};},
    dispose(){for(const target of [probeRT,wkA,wkB])target.dispose();for(const mat of [pMesh.material,wkMat,sMat,nlBeamM])mat.dispose();pGeo.dispose();sGeo.dispose();nlBeamG.dispose();sunL.removeFromParent();hemi.removeFromParent();sPts.removeFromParent();}
  };
}
