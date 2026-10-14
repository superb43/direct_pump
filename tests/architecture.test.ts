import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve, dirname, relative } from 'node:path';
import ts from 'typescript';
import { expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '..');
function runtimeSpecifiers(file: string): string[] {
  const source=ts.createSourceFile(file,readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true);
  return source.statements.flatMap(statement=>{
    if(!ts.isImportDeclaration(statement)&&!ts.isExportDeclaration(statement))return [];
    if(ts.isImportDeclaration(statement)&&statement.importClause?.isTypeOnly)return [];
    if(ts.isExportDeclaration(statement)&&statement.isTypeOnly)return [];
    const bindings=ts.isImportDeclaration(statement)?statement.importClause?.namedBindings:statement.exportClause;
    if(bindings&&(ts.isNamedImports(bindings)||ts.isNamedExports(bindings))&&bindings.elements.length&&bindings.elements.every(element=>element.isTypeOnly)&&!(ts.isImportDeclaration(statement)&&statement.importClause?.name))return [];
    if(!statement.moduleSpecifier||!ts.isStringLiteral(statement.moduleSpecifier))return [];
    return [statement.moduleSpecifier.text];
  });
}
function runtimeDependency(file:string,specifier:string):string[]{
  if(!specifier.startsWith('.')||/\.(?:css|svg|json)(?:\?.*)?$/.test(specifier))return [];
  const path=resolve(dirname(file),specifier);
  const dependency=(path.endsWith('.ts')?[path]:[`${path}.ts`,resolve(path,'index.ts')]).find(existsSync);
  if(!dependency)throw new Error(`Unresolved TypeScript dependency: ${relative(root,file)} -> ${specifier}`);
  return [dependency];
}
function runtimeImports(file:string):string[]{
  return runtimeSpecifiers(file).flatMap(specifier=>runtimeDependency(file,specifier));
}
function dependencies(entry:string):Set<string>{
  const found=new Set<string>();
  function visit(file:string){if(found.has(file))return;found.add(file);for(const dependency of runtimeImports(file))visit(dependency);}
  visit(resolve(root,entry));return found;
}
it('keeps shared UI and financial modules free of site DOM readers transitively',()=>{
  const forbidden=/^src\/(adapters\.ts|sites\/(reader|dom|gmgn|axiom|fomo)\.ts)$/;
  for(const entry of ['src/panel/panel.ts','src/panel/trading-window.ts','src/portfolio/position-view.ts','src/market.ts','src/execution.ts','src/worker/orders.ts','src/worker/queries.ts']){
    expect([...dependencies(entry)].map(file=>relative(root,file)).filter(file=>forbidden.test(file)),entry).toEqual([]);
  }
});
it('keeps the pure site catalog free of runtime browser and wallet dependencies',()=>{
  expect(runtimeSpecifiers(resolve(root,'src/sites/catalog.ts'))).toEqual([]);
});
it('keeps review and execution policies independent from views, orchestration and persistence',()=>{
  const forbidden=/^(?:server\/(?:engine|signer|store|api)\.ts|src\/pro\/(?:(?:panel|settings|withdrawal|onboarding|wallet)-view|view)\.ts|src\/worker\/|src\/sites\/(?:reader|dom|gmgn|axiom|fomo)\.ts)/;
  for(const entry of ['src/pro/panel-review.ts','server/strategy.ts','server/risk-policy.ts']){
    expect([...dependencies(entry)].map(file=>relative(root,file)).filter(file=>forbidden.test(file)),entry).toEqual([]);
  }
});
it('keeps diagnostics and pure domain entry graphs free of runtime import cycles',()=>{
  const complete=new Set<string>(),active=new Set<string>();
  function visit(file:string){
    expect(active.has(file),relative(root,file)).toBe(false);if(complete.has(file))return;
    active.add(file);for(const dependency of runtimeImports(file))visit(dependency);active.delete(file);complete.add(file);
  }
  for(const entry of ['src/diagnostics/diagnostics.ts','src/pro/panel-review.ts','server/strategy.ts'])visit(resolve(root,entry));
});
it('allows site selection only inside the fixed site boundary',()=>{
  function files(directory:string):string[]{return readdirSync(directory,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?files(resolve(directory,entry.name)):entry.name.endsWith('.ts')?[resolve(directory,entry.name)]:[]);}
  for(const file of files(resolve(root,'src')).filter(file=>!relative(root,file).startsWith('src/sites/')&&!relative(root,file).startsWith('src/vendor/'))){
    expect(readFileSync(file,'utf8')).not.toMatch(/\.site\s*={2,3}\s*['"](?:GMGN|AXIOM|FOMO)['"]/);
  }
});
it('fails on unresolved relative TypeScript dependencies instead of dropping them from the graph',()=>{
  expect(()=>runtimeDependency(resolve(root,'src/model.ts'),'./__missing_architecture_dependency__')).toThrow('Unresolved TypeScript dependency');
  expect(runtimeDependency(resolve(root,'src/model.ts'),'./model.ts')).toEqual([resolve(root,'src/model.ts')]);
  expect(runtimeDependency(resolve(root,'src/model.ts'),'./ui-tokens.css?inline')).toEqual([]);
});
