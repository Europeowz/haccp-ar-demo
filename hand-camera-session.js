/** Owns front-camera hand control and a temporary pause of the rear AR feed. */
export class HandCameraSession {
  constructor({camera, rearVideo, createController, verifyDual, verifyFront,
    onStatus = () => {}, onPreview = () => {}, onMode = () => {}, onStopped = () => {},
    isCurrent = () => true, canRestoreRear = () => true,
    schedule = (fn, ms) => setTimeout(fn, ms), cancelSchedule = id => clearTimeout(id)} = {}) {
    Object.assign(this,{camera,rearVideo,createController,verifyDual,verifyFront,onStatus,onPreview,onMode,onStopped,isCurrent,canRestoreRear,schedule,cancelSchedule});
    this._controller=null;this._frontVideo=null;this._alive=false;this._version=0;this._mode='off';
    this._starting=false;this._recovering=false;this._pausedRear=false;this._frontRestarted=false;
    this._monitorAbort=null;this._timer=null;this._lastFailure=null;this._initialRear=null;
  }
  get controller(){return this._controller;}
  get mode(){return this._mode;}
  _valid(version=this._version){return this._alive&&version===this._version&&this.isCurrent();}
  _setMode(mode){this._mode=mode;this.onMode({mode,pausedRear:this._pausedRear});}
  _cancelMonitor(){this._monitorAbort?.abort();this._monitorAbort=null;if(this._timer!==null)this.cancelSchedule(this._timer);this._timer=null;}
  _dropFront(){const old=this._controller;this._controller=null;this._frontVideo=null;old?.stop();this.onPreview(null);}
  _dispose(){this._alive=false;++this._version;this._cancelMonitor();this._dropFront();this._mode='off';}
  _shouldRestore(){return this._initialRear?.mode==='ar'&&this.camera?.getState().mode==='ar'&&this.canRestoreRear()
    &&(this._pausedRear||this._initialRear.phase==='active');}
  _restore(){try{return Promise.resolve(this.camera.resume()).catch(()=>false);}catch{return Promise.resolve(false);}}
  stop({restoreRear=true}={}){
    const restore=this._alive&&restoreRear&&this._shouldRestore();this._dispose();
    // Release the front tracks before requesting the rear camera again.
    return restore?this._restore():Promise.resolve(false);
  }
  _fail(message){
    if(!this._valid())return false;
    const restore=this._shouldRestore();this._dispose();this.onStopped({message});
    if(restore&&this.camera?.getState().mode==='ar'&&this.canRestoreRear())void this._restore();
    return false;
  }
  _cameraConflict(failure){
    if(failure?.stage==='playback')return ['TimeoutError','NotReadableError','TrackStartError','AbortError'].includes(failure.errorName);
    return failure?.stage==='camera'&&['NotReadableError','TrackStartError','OverconstrainedError','ConstraintNotSatisfiedError','FrontCameraUnavailableError','TrackEndedError'].includes(failure.errorName);
  }
  async _startFront(version){
    if(!this._valid(version))return false;
    this._lastFailure=null;this._starting=true;
    let controller;
    controller=this.createController({
      onPreview:video=>{if(!this._valid(version)||this._controller!==controller)return;this._frontVideo=video;this.onPreview(video);},
      onStatus:status=>{
        if(!this._valid(version)||this._controller!==controller)return;
        if(status.state==='error')this._lastFailure=status;
        this.onStatus(status);
        if(status.state==='stopped'&&!this._starting&&!this._recovering)queueMicrotask(()=>{
          if(this._valid(version)&&this._controller===controller&&!this._starting&&!this._recovering&&!controller.running)this._fail(status.message||'前置手势已停止。');
        });
        if(!this._starting&&!this._recovering&&status.state==='error'){
          if((this._mode==='dual'||this._mode==='checking')&&this._cameraConflict(status))void this._frontOnly(version);
          else this._fail(status.message||'前置手势已停止。');
        }
      },
    });
    this._controller=controller;
    let started=false;
    try{started=await controller.start({facingMode:'user'});}
    catch(error){this._lastFailure={message:'前置手势未能启动。',stage:error?.stage,errorName:error?.name};}
    finally{if(version===this._version&&this._controller===controller)this._starting=false;}
    if(!this._valid(version)||this._controller!==controller){controller.stop();return false;}
    return Boolean(started);
  }
  async start(){
    if(this._alive)return false;
    this._alive=true;const version=++this._version;this._initialRear=this.camera?.getState()||{mode:'3d',phase:'off'};
    this._starting=false;this._recovering=false;this._pausedRear=false;this._frontRestarted=false;this._setMode('starting');
    const started=await this._startFront(version);if(!this._valid(version))return false;
    if(!started){
      if(this._initialRear.phase==='active'&&this._cameraConflict(this._lastFailure))return this._frontOnly(version);
      return this._fail(this._lastFailure?.message||'前置手势未能启动，可继续使用触屏。');
    }
    if(this._initialRear.phase==='active'&&this._initialRear.stream){
      this._setMode('checking');return this._checkDual(version);
    }
    return this._frontOnly(version);
  }
  async _checkDual(version){
    if(!this._valid(version))return false;
    this._cancelMonitor();const abort=new AbortController();this._monitorAbort=abort;
    let result;try{result=await this.verifyDual({rearStream:this._initialRear.stream,rearVideo:this.rearVideo,frontVideo:this._frontVideo,timeoutMs:1600,signal:abort.signal});}
    catch{result={supported:false};}
    if(!this._valid(version)||abort.signal.aborted)return false;
    if(!result.supported)return this._frontOnly(version);
    this._setMode('dual');if(!this._valid(version))return false;
    this._timer=this.schedule(()=>{this._timer=null;void this._checkDual(version);},1500);return true;
  }
  async _frontOnly(version){
    if(!this._valid(version)||this._recovering)return false;
    this._recovering=true;this._cancelMonitor();
    if(this._initialRear.mode==='ar'&&!this._pausedRear){
      this._pausedRear=true;this.camera.stop({reason:'hands',message:'前置手势使用中，后置实景已暂停；关闭手势后恢复。'});
    }
    this._setMode('switching');
    try{
      let healthy=this._controller?.running&&this._frontVideo?await this._checkFront(version):false;
      if(!this._valid(version))return false;
      // Keep a healthy front stream; only reconnect once if it was displaced.
      if(!healthy){
        if(this._frontRestarted)return this._fail('前置相机未能持续显示，请重试手势或使用触屏。');
        this._frontRestarted=true;this._dropFront();
        if(!await this._startFront(version)){if(!this._valid(version))return false;return this._fail(this._lastFailure?.message||'前置相机暂不可用。');}
        healthy=await this._checkFront(version);
      }
      if(!this._valid(version))return false;
      if(!healthy)return this._fail('前置相机画面未持续更新，请重试手势或使用触屏。');
      this._setMode('front-only');if(!this._valid(version))return false;
      this._scheduleFront(version);return true;
    }finally{if(version===this._version)this._recovering=false;}
  }
  async _checkFront(version){
    if(!this._valid(version))return false;
    this._cancelMonitor();const abort=new AbortController();this._monitorAbort=abort;
    let result;try{result=await this.verifyFront({stream:this._frontVideo?.srcObject,video:this._frontVideo,timeoutMs:1600,signal:abort.signal});}
    catch{result={supported:false};}
    return this._valid(version)&&!abort.signal.aborted&&result.supported;
  }
  _scheduleFront(version){
    if(!this._valid(version))return;
    this._timer=this.schedule(async()=>{
      this._timer=null;const healthy=await this._checkFront(version);if(!this._valid(version))return;
      if(!healthy)this._fail('前置手势画面已中断，已关闭手势。');else this._scheduleFront(version);
    },1500);
  }
}
