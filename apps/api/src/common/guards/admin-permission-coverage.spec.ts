import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';
import ts from 'typescript';

const HTTP_METHOD_DECORATORS = new Set([
  'Get',
  'Post',
  'Put',
  'Patch',
  'Delete',
  'Head',
  'Options',
  'All',
]);

const EXPLICIT_PERMISSION_DECORATORS = new Set([
  'RequireAdminPermission',
  'NoAdminPermissionRequired',
  'Public',
]);

const ADMIN_CONTROLLER_GUARDS = new Set([
  'AdminJwtAuthGuard',
  'AdminPermissionGuard',
]);

function controllerFiles(dir: string): string[] {
  const result: string[] = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      result.push(...controllerFiles(fullPath));
      continue;
    }
    if (entry.endsWith('.controller.ts') && !entry.endsWith('.spec.ts')) {
      result.push(fullPath);
    }
  }
  return result;
}

function sourceFiles(dir: string): string[] {
  const result: string[] = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      result.push(...sourceFiles(fullPath));
      continue;
    }
    if (entry.endsWith('.ts') && !entry.endsWith('.spec.ts')) {
      result.push(fullPath);
    }
  }
  return result;
}

function decoratorsOf(node: ts.Node): readonly ts.Decorator[] {
  return ts.canHaveDecorators(node) ? ts.getDecorators(node) ?? [] : [];
}

function decoratorCall(decorator: ts.Decorator): ts.CallExpression | null {
  return ts.isCallExpression(decorator.expression) ? decorator.expression : null;
}

function callName(call: ts.CallExpression): string | null {
  const expression = call.expression;
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  return null;
}

function hasDecorator(node: ts.Node, names: Set<string>): boolean {
  return decoratorsOf(node).some((decorator) => {
    const call = decoratorCall(decorator);
    return call ? names.has(callName(call) ?? '') : false;
  });
}

function decoratorCalls(node: ts.Node, name: string): ts.CallExpression[] {
  return decoratorsOf(node).flatMap((decorator) => {
    const call = decoratorCall(decorator);
    return call && callName(call) === name ? [call] : [];
  });
}

function useGuardNames(node: ts.Node): Set<string> {
  const names = new Set<string>();
  for (const call of decoratorCalls(node, 'UseGuards')) {
    for (const arg of call.arguments) {
      names.add(arg.getText());
    }
  }
  return names;
}

function usesAdminPermissionGuard(node: ts.Node): boolean {
  return useGuardNames(node).has('AdminPermissionGuard');
}

function hasAdminControllerGuards(node: ts.Node): boolean {
  const guards = useGuardNames(node);
  return Array.from(ADMIN_CONTROLLER_GUARDS).every((guard) => guards.has(guard));
}

function controllerPath(node: ts.Node): string | null {
  const call = decoratorCalls(node, 'Controller')[0];
  if (!call) return null;
  const firstArg = call.arguments[0];
  if (!firstArg) return '';
  if (ts.isStringLiteral(firstArg) || ts.isNoSubstitutionTemplateLiteral(firstArg)) {
    return firstArg.text;
  }
  return firstArg.getText();
}

function isAdminControlPlanePath(path: string): boolean {
  const normalized = path.replace(/^\/+/, '').replace(/\/+$/, '');
  return normalized === 'admin' || normalized.startsWith('admin/');
}

function objectLiteralHasProperty(
  node: ts.ObjectLiteralExpression,
  keyName: string,
  valueName: string,
): boolean {
  return node.properties.some((property) => {
    if (!ts.isPropertyAssignment(property)) return false;
    const name = property.name;
    const initializer = property.initializer;
    const propertyName =
      ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)
        ? name.text
        : name.getText();
    return propertyName === keyName && initializer.getText() === valueName;
  });
}

function hasGlobalAppGuard(sourceRoot: string, guardName: string): boolean {
  for (const file of sourceFiles(sourceRoot)) {
    const source = ts.createSourceFile(
      file,
      readFileSync(file, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
    );
    let found = false;
    const visit = (node: ts.Node): void => {
      if (found) return;
      if (
        ts.isObjectLiteralExpression(node) &&
        objectLiteralHasProperty(node, 'provide', 'APP_GUARD') &&
        objectLiteralHasProperty(node, 'useClass', guardName)
      ) {
        found = true;
        return;
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    if (found) return true;
  }
  return false;
}

function methodName(member: ts.MethodDeclaration): string {
  const name = member.name;
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  return name.getText();
}

describe('admin permission metadata coverage', () => {
  it('requires admin control-plane controllers to mount admin guards', () => {
    const sourceRoot = join(__dirname, '../..');
    const hasGlobalAdminGuards = Array.from(ADMIN_CONTROLLER_GUARDS)
      .every((guard) => hasGlobalAppGuard(sourceRoot, guard));
    if (hasGlobalAdminGuards) return;

    const missing: string[] = [];

    for (const file of controllerFiles(sourceRoot)) {
      const source = ts.createSourceFile(
        file,
        readFileSync(file, 'utf8'),
        ts.ScriptTarget.Latest,
        true,
      );

      source.forEachChild((node) => {
        if (!ts.isClassDeclaration(node)) return;
        const path = controllerPath(node);
        if (path === null || !isAdminControlPlanePath(path)) return;
        if (hasDecorator(node, new Set(['Public']))) return;
        if (hasAdminControllerGuards(node)) return;
        missing.push(`${relative(sourceRoot, file)}:${node.name?.text ?? '<anonymous>'} @Controller('${path}')`);
      });
    }

    expect(missing).toEqual([]);
  });

  it('requires every AdminPermissionGuard route to declare permission metadata', () => {
    const sourceRoot = join(__dirname, '../..');
    const missing: string[] = [];

    for (const file of controllerFiles(sourceRoot)) {
      const source = ts.createSourceFile(
        file,
        readFileSync(file, 'utf8'),
        ts.ScriptTarget.Latest,
        true,
      );

      source.forEachChild((node) => {
        if (!ts.isClassDeclaration(node) || !usesAdminPermissionGuard(node)) return;
        const classHasExplicitPermission = hasDecorator(node, EXPLICIT_PERMISSION_DECORATORS);

        for (const member of node.members) {
          if (!ts.isMethodDeclaration(member)) continue;
          if (!hasDecorator(member, HTTP_METHOD_DECORATORS)) continue;
          if (classHasExplicitPermission || hasDecorator(member, EXPLICIT_PERMISSION_DECORATORS)) continue;
          missing.push(`${relative(sourceRoot, file)}:${node.name?.text ?? '<anonymous>'}.${methodName(member)}`);
        }
      });
    }

    expect(missing).toEqual([]);
  });

  it('uses narrow page or hidden data capabilities instead of coarse legacy atoms', () => {
    const sourceRoot = join(__dirname, '../..');
    const offenders: string[] = [];

    for (const file of controllerFiles(sourceRoot)) {
      const source = ts.createSourceFile(
        file,
        readFileSync(file, 'utf8'),
        ts.ScriptTarget.Latest,
        true,
      );

      source.forEachChild((node) => {
        if (!ts.isClassDeclaration(node) || !usesAdminPermissionGuard(node)) return;
        for (const member of node.members) {
          if (!ts.isMethodDeclaration(member) || !hasDecorator(member, HTTP_METHOD_DECORATORS)) continue;
          for (const call of decoratorCalls(member, 'RequireAdminPermission')) {
            for (const argument of call.arguments) {
              if (!ts.isStringLiteral(argument) && !ts.isNoSubstitutionTemplateLiteral(argument)) continue;
              if (/^admin\.(page|data|catalog)\./.test(argument.text)) continue;
              offenders.push(
                `${relative(sourceRoot, file)}:${node.name?.text ?? '<anonymous>'}.${methodName(member)} -> ${argument.text}`,
              );
            }
          }
        }
      });
    }

    expect(offenders).toEqual([]);
  });
});
