import csv, json
from collections import defaultdict
from pathlib import Path

results = Path('evaluation/results')
blind_path = max(results.glob('*-manual-scoring-blind.csv'), key=lambda item: item.stat().st_mtime)
stamp = blind_path.name.removesuffix('-manual-scoring-blind.csv')
key_path = results / f'{stamp}-manual-scoring-key.csv'

scores = {
'S001':(4,0,4,'定义正确、例子清楚，但没有教材引用。'),
'S002':(4,1,4,'悖论解释和出处基本正确，“不可能”表述略绝对。'),
'S003':(4,1,4,'教材依据明确，定义略偏重身体对脑发育的影响。'),
'S004':(4,0,4,'核心解释正确、启发性较好，但没有教材引用。'),
'S005':(2,0,2,'只承诺画图和举例，没有真正完成解释。'),
'S006':(4,0,4,'能纠正误解并说明闭环，缺少教材依据。'),
'S007':(4,0,4,'区别清晰，但“纯靠抽象计算”略显绝对且无引用。'),
'S008':(4,0,4,'能用身体经验解释抽象概念，缺少教材引用。'),
'S009':(4,0,4,'核心含义正确且说明证据不足，教学表达清楚。'),
'S010':(5,1,4,'内容完整、引用匹配，解释较正式但适应性良好。'),
'S011':(4,0,4,'正确否定数量决定论，但略过度强调算法。'),
'S012':(4,0,4,'悖论概括准确易懂，但没有教材引用。'),
'S013':(5,1,5,'换用触摸实例重新解释，引用与问题匹配。'),
'S014':(3,0,3,'方向正确但把智能过度简化为算法处理。'),
'S015':(3,0,3,'身体影响判断的例子相关，但没有充分解释具身机制。'),
'S016':(5,0,5,'骑车实例非常适合“没听懂”后的简化解释。'),
'S017':(5,0,5,'婴儿爬行、试错和反馈闭环解释清晰。'),
'S018':(5,0,5,'语言简短，明显换了一种更易懂的解释方式。'),
'S019':(4,0,4,'核心正确并谨慎披露证据不足，仍缺教材支撑。'),
'S020':(5,1,5,'接球例子直观，能针对困惑换角度并使用教材依据。'),
'S021':(5,1,5,'比较维度完整，引用与结论一致，教学结构清楚。'),
'S022':(4,1,4,'教材依据充分，“必须有身体”措辞稍绝对。'),
'S023':(5,1,4,'定义、例子和引用完整，篇幅略长。'),
'S024':(3,0,3,'结论正确，但再次把智能简化为算法，解释偏浅。'),
'S025':(5,1,4,'悖论定义准确、例子和出处完整。'),
'S026':(5,1,4,'简洁覆盖交互、莫拉维克悖论和形态计算。'),
'S027':(5,1,5,'菜谱与下厨类比非常适合困惑追问，引用充分。'),
'S028':(4,0,4,'核心正确且有互动提问，但没有教材依据。'),
'S029':(2,0,4,'换例子意识较好，但冷热咖啡社会判断效应存在争议。'),
'S030':(3,0,3,'抓住交互区别，但把传统AI概括为静态数据过于简单。'),
'S031':(4,1,4,'总体比较正确并强调互补，类别概括略简化。'),
'S032':(5,0,5,'骑车实例短而有效，符合助教简化解释目标。'),
'S033':(5,1,4,'回答完整且引用准确，适应性正常。'),
'S034':(5,0,5,'婴儿爬行例子完整呈现身体、环境和试错。'),
'S035':(4,0,4,'定义正确、闭环清晰，但没有教材引用。'),
'S036':(5,0,5,'例子贴题、表达简洁，并明确未引用教材。'),
'S037':(5,1,4,'定义准确、引用明确且简洁。'),
'S038':(5,1,4,'莫拉维克悖论与形态计算均能支持结论。'),
'S039':(5,1,4,'内容和引用扎实，解释略偏正式。'),
'S040':(3,0,3,'纠正方向正确，但称身体只是载体会弱化具身观点。'),
'S041':(5,1,4,'教材例子匹配，定义和互动问题清晰。'),
'S042':(5,1,5,'比较准确、引用充分，并指出两者互补。'),
'S043':(5,1,5,'针对“不明白”改用下棋与接球对比，解释很有效。'),
'S044':(5,1,4,'具身/离身区别及互补关系表达准确，引用充分。'),
'S045':(4,0,4,'能纠正误解并诚实披露无教材出处。'),
}

with blind_path.open(encoding='utf-8-sig', newline='') as f:
    blind = list(csv.DictReader(f))
with key_path.open(encoding='utf-8-sig', newline='') as f:
    key = {row['sample_id']: row for row in csv.DictReader(f)}

assert len(blind) == len(scores) == 45
scored=[]
for row in blind:
    sid=row['sample_id']
    content,citation,adapt,notes=scores[sid]
    out=dict(row)
    out['content_correctness_1_5']=content
    out['citation_correctness_0_1']=citation
    out['teaching_adaptability_1_5']=adapt
    out['reviewer']='Codex AI 初评（非人工评委）'
    out['notes']=notes
    scored.append(out)

scored_path=results / f'{stamp}-manual-scoring-ai-initial.csv'
with scored_path.open('w',encoding='utf-8-sig',newline='') as f:
    w=csv.DictWriter(f,fieldnames=scored[0].keys())
    w.writeheader(); w.writerows(scored)

agg=defaultdict(lambda:{'n':0,'content':0,'citation':0,'adapt':0})
cat=defaultdict(lambda:{'n':0,'content':0,'citation':0,'adapt':0})
for row in scored:
    variant=key[row['sample_id']]['variant']
    a=agg[variant]; a['n']+=1; a['content']+=int(row['content_correctness_1_5']); a['citation']+=int(row['citation_correctness_0_1']); a['adapt']+=int(row['teaching_adaptability_1_5'])
    c=cat[(variant,row['category'])]; c['n']+=1; c['content']+=int(row['content_correctness_1_5']); c['citation']+=int(row['citation_correctness_0_1']); c['adapt']+=int(row['teaching_adaptability_1_5'])

summary=[]
for variant in ('A','B','C'):
    a=agg[variant]
    summary.append({'variant':variant,'scored_responses':a['n'],'content_correctness_avg_1_5':round(a['content']/a['n'],3),'citation_correctness_rate':round(a['citation']/a['n'],3),'teaching_adaptability_avg_1_5':round(a['adapt']/a['n'],3),'reviewer':'Codex AI 初评（非人工评委）'})
summary_path=results / f'{stamp}-ai-scoring-summary.csv'
with summary_path.open('w',encoding='utf-8-sig',newline='') as f:
    w=csv.DictWriter(f,fieldnames=summary[0].keys()); w.writeheader(); w.writerows(summary)

category_rows=[]
for (variant,category),a in sorted(cat.items()):
    category_rows.append({'variant':variant,'category':category,'n':a['n'],'content_correctness_avg_1_5':round(a['content']/a['n'],3),'citation_correctness_rate':round(a['citation']/a['n'],3),'teaching_adaptability_avg_1_5':round(a['adapt']/a['n'],3)})
cat_path=results / f'{stamp}-ai-scoring-by-category.csv'
with cat_path.open('w',encoding='utf-8-sig',newline='') as f:
    w=csv.DictWriter(f,fieldnames=category_rows[0].keys()); w.writeheader(); w.writerows(category_rows)

print(json.dumps({'scored_file':scored_path.name,'summary_file':summary_path.name,'category_file':cat_path.name,'summary':summary},ensure_ascii=False,indent=2))
