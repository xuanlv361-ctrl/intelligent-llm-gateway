import {Component,type ErrorInfo,type ReactNode} from "react";
import {translate as t,useLocale} from "../i18n";

type Props={children:ReactNode};
type State={failed:boolean};

// The class boundary delegates locale subscriptions to this private recovery view.
// eslint-disable-next-line react-refresh/only-export-components
function RecoveryView({onRetry}:{onRetry:()=>void}){
  useLocale();
  return <main className="app-error-boundary" role="alert"><section className="panel">
    <p className="eyebrow">{t("LOCAL UI RECOVERY")}</p><h1>{t("页面暂时无法显示")}</h1>
    <p>{t("本地界面遇到未预期错误。数据和凭据未在此处展示，也不会自动发起外部请求。")}</p>
    <button onClick={onRetry}>{t("重试渲染")}</button>
  </section></main>;
}

export default class AppErrorBoundary extends Component<Props,State>{
  state:State={failed:false};
  static getDerivedStateFromError():State{return {failed:true}}
  componentDidCatch(error:Error,info:ErrorInfo){
    console.error("Routing Quality Console render failure",error.name,info.componentStack?.split("\n")[1]?.trim()||"unknown component");
  }
  render(){
    if(!this.state.failed)return this.props.children;
    return <RecoveryView onRetry={()=>this.setState({failed:false})}/>;
  }
}
