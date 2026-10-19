const rows:[string,string,string][]=[
  ['{0} 入 / {1} 出','{0} in / {1} out','入力 {0} / 出力 {1}'],
  ['≥ {0} 秒','≥ {0} seconds','≥ {0} 秒'],
  ['创建受控任务','Create controlled task','管理タスクを作成'],
  ['刷新模型目录','Refresh model catalog','モデルカタログを更新'],
  ['同步能力信息','Sync capability information','能力情報を同期'],
  ['查看全部','View all','すべて表示'],
  ['查看执行记录','View execution records','実行記録を表示'],
];
export const catalog=Object.fromEntries(rows.map(([zh,en,ja])=>[zh,{en,zh,ja}]));
