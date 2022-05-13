
import { table } from 'console';
import { Stmt, Expr, Type, UniOp, BinOp, Literal, Program, FunDef, VarInit, Class } from './ast';
import { NUM, BOOL, NONE, CLASS } from './utils';
import { emptyEnv } from './compiler';

// I ❤️ TypeScript: https://github.com/microsoft/TypeScript/issues/13965
export class TypeCheckError extends Error {
   __proto__: Error
   constructor(message?: string) {
    const trueProto = new.target.prototype;
    super("TYPE ERROR: " + message);

    // Alternatively use Object.setPrototypeOf if you have an ES6 environment.
    this.__proto__ = trueProto;
  } 
}

export type GlobalTypeEnv = {
  globals: Map<string, Type>,
  functions: Map<string, [Array<Type>, Type]>,
  // Added one more field to track supers
  classes: Map<string, [Array<string>, Map<string, Type>, Map<string, [Array<Type>, Type]>]>
}

export type LocalTypeEnv = {
  vars: Map<string, Type>,
  expectedRet: Type,
  actualRet: Type,
  topLevel: Boolean
}

const defaultGlobalFunctions = new Map();
defaultGlobalFunctions.set("abs", [[NUM], NUM]);
defaultGlobalFunctions.set("max", [[NUM, NUM], NUM]);
defaultGlobalFunctions.set("min", [[NUM, NUM], NUM]);
defaultGlobalFunctions.set("pow", [[NUM, NUM], NUM]);
defaultGlobalFunctions.set("print", [[CLASS("object")], NUM]);

// To track the ordering of classes in the program
const classOrder: Array<String> = new Array<string>();
// Map from class name to Class<A>
// Needed because we need to populate all the super class fields and methods in subclass
const classMap: Map<string,Class<any>> = new Map();


export const defaultTypeEnv = {
  globals: new Map(),
  functions: defaultGlobalFunctions,
  classes: new Map(),
};

export function emptyGlobalTypeEnv() : GlobalTypeEnv {
  return {
    globals: new Map(),
    functions: new Map(),
    classes: new Map()
  };
}

export function emptyLocalTypeEnv() : LocalTypeEnv {
  return {
    vars: new Map(),
    expectedRet: NONE,
    actualRet: NONE,
    topLevel: true
  };
}

export type TypeError = {
  message: string
}

export function equalType(t1: Type, t2: Type) {
  return (
    t1 === t2 ||
    (t1.tag === "class" && t2.tag === "class" && t1.name === t2.name)
  );
}

export function isNoneOrClass(t: Type) {
  return t.tag === "none" || t.tag === "class";
}

// t2 = t1
// Added code to support subclass assignable to superclass

export function isSubtype(env: GlobalTypeEnv, t1: Type, t2: Type): boolean {
  if (equalType(t1, t2)) {
    return true;
  } else if (t1.tag === "none" && t2.tag === "class") {
    return true;
  } else if (t1.tag === "class" && t2.tag ==="class"){
    const supers = env.classes.get(t1.name)[0];
    if(supers.includes(t2.name) || t2.name === "object"){
      return true;
    }
    var isSupType = false;
    supers.forEach(sup => {
      var supType : Type = { tag: "class", name: sup};
      if (isSubtype(env, supType, t2)) {
        isSupType = true;
      }
    });
    return isSupType;
  } else {
    return false;
  }
}

export function isAssignable(env : GlobalTypeEnv, t1 : Type, t2 : Type) : boolean {
  return isSubtype(env, t1, t2);
}

export function join(env : GlobalTypeEnv, t1 : Type, t2 : Type) : Type {
  return NONE
}

export function augmentTEnv(env : GlobalTypeEnv, program : Program<null>) : GlobalTypeEnv {
  const newGlobs = new Map(env.globals);
  const newFuns = new Map(env.functions);
  const newClasses = new Map(env.classes);
  program.inits.forEach(init => newGlobs.set(init.name, init.type));
  program.funs.forEach(fun => newFuns.set(fun.name, [fun.parameters.map(p => p.type), fun.ret]));
  program.classes.forEach(cls => {
    classOrder.push(cls.name); // a class may not declare a superclass whose classdef occurs after it in the parsed order
    const fields = new Map();
    const methods = new Map();
    cls.fields.forEach(field => fields.set(field.name, field.type)); // only the explicitly declared fields and methods here; inherited ones are handled in tcClass
    cls.methods.forEach(method => methods.set(method.name, [method.parameters.map(p => p.type), method.ret]));
    const supers = cls.supers;
    newClasses.set(cls.name, [supers, fields, methods]);
  });
  return { globals: newGlobs, functions: newFuns, classes: newClasses };
}

export function tc(env : GlobalTypeEnv, program : Program<null>) : [Program<Type>, GlobalTypeEnv] {
  const locals = emptyLocalTypeEnv();
  const newEnv = augmentTEnv(env, program);
  const tInits = program.inits.map(init => tcInit(env, init));
  const tDefs = program.funs.map(fun => tcDef(newEnv, fun));
  const tClasses = program.classes.map(cls => tcClass(newEnv, cls));

  // program.inits.forEach(init => env.globals.set(init.name, tcInit(init)));
  // program.funs.forEach(fun => env.functions.set(fun.name, [fun.parameters.map(p => p.type), fun.ret]));
  // program.funs.forEach(fun => tcDef(env, fun));
  // Strategy here is to allow tcBlock to populate the locals, then copy to the
  // global env afterwards (tcBlock changes locals)
  const tBody = tcBlock(newEnv, locals, program.stmts);
  var lastTyp : Type = NONE;
  if (tBody.length){
    lastTyp = tBody[tBody.length - 1].a;
  }
  // TODO(joe): check for assignment in existing env vs. new declaration
  // and look for assignment consistency
  for (let name of locals.vars.keys()) {
    newEnv.globals.set(name, locals.vars.get(name));
  }
  const aprogram = {a: lastTyp, inits: tInits, funs: tDefs, classes: tClasses, stmts: tBody};
  return [aprogram, newEnv];
}

export function tcInit(env: GlobalTypeEnv, init : VarInit<null>) : VarInit<Type> {
  const valTyp = tcLiteral(init.value);
  if (isAssignable(env, valTyp, init.type)) {
    return {...init, a: NONE};
  } else {
    throw new TypeCheckError("Expected type `" + init.type + "`; got type `" + valTyp + "`");
  }
}

export function tcDef(env : GlobalTypeEnv, fun : FunDef<null>) : FunDef<Type> {
  var locals = emptyLocalTypeEnv();
  locals.expectedRet = fun.ret;
  locals.topLevel = false;
  fun.parameters.forEach(p => locals.vars.set(p.name, p.type));
  fun.inits.forEach(init => locals.vars.set(init.name, tcInit(env, init).type));
  
  const tBody = tcBlock(env, locals, fun.body);
  if (!isAssignable(env, locals.actualRet, locals.expectedRet))
    throw new TypeCheckError(`expected return type of block: ${JSON.stringify(locals.expectedRet)} does not match actual return type: ${JSON.stringify(locals.actualRet)}`)
  return {...fun, a: NONE, body: tBody};
}

export function tcSign(env: GlobalTypeEnv, clsName: string){
  const [supers, fields, methods] = env.classes.get(clsName);
  methods.forEach((sign, name) => {
    var [argTyp, retTyp] = sign;
    argTyp = argTyp.slice(1,argTyp.length);
    supers.forEach(sup=> {
      const supMethods = env.classes.get(sup)[2];
      if (supMethods.has(name)) {
        var [supArgTyp,supRetTyp] = supMethods.get(name);
        supArgTyp = supArgTyp.slice(1,supArgTyp.length);
        if(JSON.stringify(supArgTyp)!=JSON.stringify(argTyp)) {
          throw new TypeCheckError(`Method overriden with different type signature: ${name}`);
        }
        if(JSON.stringify(supRetTyp)!=JSON.stringify(retTyp)) {
          throw new TypeCheckError(`Method overriden with different type signature: ${name}`);
        }
      }
    });
  });
  
}

export function tcClass(env: GlobalTypeEnv, cls : Class<null>) : Class<Type> {
  // Check whether super-classes are defined before the definition of current class
  const clsOrder = classOrder.indexOf(cls.name);
  cls.supers.forEach(sup => {
    if(sup === "int" || sup === "bool") {
      // ??? why is this here? it seems redundant with the below conditional
    }
    if(!env.classes.has(sup)) { // this feels redundant w/ the classOrder check
      throw new TypeCheckError(`Super-class not defined : ${sup}`);
    }
    const supOrder = classOrder.indexOf(sup);
    if (supOrder >= clsOrder) {
      throw new TypeCheckError(`Super-class not defined : ${sup}`);
    }
  });
  // Set classMap
  classMap.set(cls.name,cls);
  // cls -> Class<A> : Field: VarInit<A>[]
  // GlobalEnv
  // Check whether fields overlap between superclasses and subclass
  
  // it suffices to only check one level up because we enforce an ordering of super and subclasses
  /*
  class A(object)
  class B(A)
  class C(B)

  by the time we typecheck C, B and A have already been typechecked
  therefore, env.classes.get("B")[1] should in theory contain the fields B inherits from A
  
  1) *this* class's fields should not attempt to redefine an inherited field
  2) add all inherited fields to *this* class's field map
  */
  const tFieldDefs = cls.fields.map(field => tcInit(env, field)); // *this* class' parsed field declarations; does not include any inherited fields yet
  const allFields = env.classes.get(cls.name)[1];
  tFieldDefs.forEach(field => {
    cls.supers.forEach(sup => {
      const supFields = env.classes.get(sup)[1];
      if(supFields.has(field.name)) {
        throw new TypeCheckError(`Cannot re-define attribute ${field.name}`);
      }
    });
  });
  cls.supers.forEach(sup => {
    const superclassdef = classMap.get(sup);
    const supFields = env.classes.get(sup)[1];
    supFields.forEach((fieldType, fieldName) => { // foreach on map runs on (value, key) order
      if(!allFields.has(fieldName)) {
        allFields.set(fieldName, fieldType); // update the environment w/ the inherited field
        superclassdef.fields.forEach(fielddef => { // this is extremely ugly O(n) bc our global env doesn't store varinits, only field name + type
          if (fielddef.name === fieldName) {
            console.log(`${cls.name} is inheriting ${fielddef.name} from ${sup}`);
            tFieldDefs.push(fielddef); // update this AST class struct w/ the inherited field def
          } else {
            console.log(fielddef.name);
          }
        });
      } else {
        throw new TypeCheckError("this should never happen");
      }
    });
  });
  
  const tMethods = cls.methods.map(method => tcDef(env, method));
  
  // To check if we have method overwritten with different signature in the derived class
  tcSign(env, cls.name);
  
  const init = cls.methods.find(method => method.name === "__init__") // we'll always find __init__
  if (init.parameters.length !== 1 || 
    init.parameters[0].name !== "self" ||
    !equalType(init.parameters[0].type, CLASS(cls.name)) ||
    init.ret !== NONE)
    throw new TypeCheckError("Cannot override __init__ type signature");

  // To check if the first argument of each method is self
  cls.methods.forEach(m => {
    if(m.parameters.length == 0) {
      throw new TypeCheckError(`First parameter of the following method must be of the enclosing class: ${cls.name}`);
    }
    var firstParam = m.parameters[0];
    if(!(firstParam.type.tag==="class" && firstParam.type.name === cls.name)) {
      throw new TypeCheckError(`First parameter of the following method must be of the enclosing class: ${cls.name}`);
    }
  });

  // Push super class methods to derived class env
  const curMethods = env.classes.get(cls.name)[2];
  cls.supers.forEach(sup => {
    const supMethods = env.classes.get(sup)[2];
    supMethods.forEach((typeArr, name) => {
      if(!curMethods.has(name)){
        curMethods.set(name,typeArr);
      }
    });
  });
  const newClassDef = {a: NONE, name: cls.name, fields: tFieldDefs, methods: tMethods}; // update the global map w/ the updated fields/methods, including all inherited ones
  classMap.set(cls.name, newClassDef);
  return newClassDef;
}

// export function hasField(env:GlobalTypeEnv,className:string,fieldName:string): boolean {
//   var [_,fields] = env.classes.get(className);
//   if(fields.has(fieldName)){
//     return true;
//   }else{
//     var supHasField = false;
//     env.classes.get(className)[0].forEach(sup => {
//       if (hasField(env, sup, fieldName)) {
//         supHasField = true;
//       }
//     });
//     return supHasField;
//   }
// }

// export function hasMethod(env:GlobalTypeEnv,className:string,methodName:string): boolean {
//   var [_,fields,methods] = env.classes.get(className);
//   if(methods.has(methodName)){
//     return true;
//   }else{
//     var supHasMethod = false;
//     env.classes.get(className)[0].forEach(sup => {
//       if (hasMethod(env, sup, methodName)) {
//         supHasMethod = true;
//       }
//     });
//     return supHasMethod;
//   }
// }

export function tcBlock(env : GlobalTypeEnv, locals : LocalTypeEnv, stmts : Array<Stmt<null>>) : Array<Stmt<Type>> {
  var tStmts = stmts.map(stmt => tcStmt(env, locals, stmt));
  return tStmts;
}

export function tcStmt(env : GlobalTypeEnv, locals : LocalTypeEnv, stmt : Stmt<null>) : Stmt<Type> {
  switch(stmt.tag) {
    case "assign":
      const tValExpr = tcExpr(env, locals, stmt.value);
      var nameTyp;
      if (locals.vars.has(stmt.name)) {
        nameTyp = locals.vars.get(stmt.name);
      } else if (env.globals.has(stmt.name)) {
        nameTyp = env.globals.get(stmt.name);
      } else {
        throw new TypeCheckError("Unbound id: " + stmt.name);
      }
      if(!isAssignable(env, tValExpr.a, nameTyp)) 
        throw new TypeCheckError("Non-assignable types");
      return {a: NONE, tag: stmt.tag, name: stmt.name, value: tValExpr};
    case "expr":
      const tExpr = tcExpr(env, locals, stmt.expr);
      return {a: tExpr.a, tag: stmt.tag, expr: tExpr};
    case "if":
      var tCond = tcExpr(env, locals, stmt.cond);
      const tThn = tcBlock(env, locals, stmt.thn);
      const thnTyp = locals.actualRet;
      locals.actualRet = NONE;
      const tEls = tcBlock(env, locals, stmt.els);
      const elsTyp = locals.actualRet;
      if (tCond.a !== BOOL) 
        throw new TypeCheckError("Condition Expression Must be a bool");
      if (thnTyp !== elsTyp)
        locals.actualRet = { tag: "either", left: thnTyp, right: elsTyp }
      return {a: thnTyp, tag: stmt.tag, cond: tCond, thn: tThn, els: tEls};
    case "return":
      if (locals.topLevel)
        throw new TypeCheckError("cannot return outside of functions");
      const tRet = tcExpr(env, locals, stmt.value);
      if (!isAssignable(env, tRet.a, locals.expectedRet)) 
        throw new TypeCheckError("expected return type `" + (locals.expectedRet as any).tag + "`; got type `" + (tRet.a as any).tag + "`");
      locals.actualRet = tRet.a;
      return {a: tRet.a, tag: stmt.tag, value:tRet};
    case "while":
      var tCond = tcExpr(env, locals, stmt.cond);
      const tBody = tcBlock(env, locals, stmt.body);
      if (!equalType(tCond.a, BOOL)) 
        throw new TypeCheckError("Condition Expression Must be a bool");
      return {a: NONE, tag:stmt.tag, cond: tCond, body: tBody};
    case "pass":
      return {a: NONE, tag: stmt.tag};
    case "field-assign":
      var tObj = tcExpr(env, locals, stmt.obj);
      const tVal = tcExpr(env, locals, stmt.value);
      if (tObj.a.tag !== "class") 
        throw new TypeCheckError("field assignments require an object");
      if (!env.classes.has(tObj.a.name)) 
        throw new TypeCheckError("field assignment on an unknown class");
      const [_,fields] = env.classes.get(tObj.a.name);
      if (!fields.has(stmt.field)) 
        throw new TypeCheckError(`could not find field ${stmt.field} in class ${tObj.a.name}`);
      if (!isAssignable(env, tVal.a, fields.get(stmt.field)))
        throw new TypeCheckError(`could not assign value of type: ${tVal.a}; field ${stmt.field} expected type: ${fields.get(stmt.field)}`);
      return {...stmt, a: NONE, obj: tObj, value: tVal};
  }
}

export function tcExpr(env : GlobalTypeEnv, locals : LocalTypeEnv, expr : Expr<null>) : Expr<Type> {
  switch(expr.tag) {
    case "literal": 
      return {...expr, a: tcLiteral(expr.value)};
    case "binop":
      const tLeft = tcExpr(env, locals, expr.left);
      const tRight = tcExpr(env, locals, expr.right);
      const tBin = {...expr, left: tLeft, right: tRight};
      switch(expr.op) {
        case BinOp.Plus:
        case BinOp.Minus:
        case BinOp.Mul:
        case BinOp.IDiv:
        case BinOp.Mod:
          if(equalType(tLeft.a, NUM) && equalType(tRight.a, NUM)) { return {a: NUM, ...tBin}}
          else { throw new TypeCheckError("Type mismatch for numeric op" + expr.op); }
        case BinOp.Eq:
        case BinOp.Neq:
          if(tLeft.a.tag === "class" || tRight.a.tag === "class") throw new TypeCheckError("cannot apply operator '==' on class types")
          if(equalType(tLeft.a, tRight.a)) { return {a: BOOL, ...tBin} ; }
          else { throw new TypeCheckError("Type mismatch for op" + expr.op)}
        case BinOp.Lte:
        case BinOp.Gte:
        case BinOp.Lt:
        case BinOp.Gt:
          if(equalType(tLeft.a, NUM) && equalType(tRight.a, NUM)) { return {a: BOOL, ...tBin} ; }
          else { throw new TypeCheckError("Type mismatch for op" + expr.op) }
        case BinOp.And:
        case BinOp.Or:
          if(equalType(tLeft.a, BOOL) && equalType(tRight.a, BOOL)) { return {a: BOOL, ...tBin} ; }
          else { throw new TypeCheckError("Type mismatch for boolean op" + expr.op); }
        case BinOp.Is:
          if(!isNoneOrClass(tLeft.a) || !isNoneOrClass(tRight.a))
            throw new TypeCheckError("is operands must be objects");
          return {a: BOOL, ...tBin};
      }
    case "uniop":
      const tExpr = tcExpr(env, locals, expr.expr);
      const tUni = {...expr, a: tExpr.a, expr: tExpr}
      switch(expr.op) {
        case UniOp.Neg:
          if(equalType(tExpr.a, NUM)) { return tUni }
          else { throw new TypeCheckError("Type mismatch for op" + expr.op);}
        case UniOp.Not:
          if(equalType(tExpr.a, BOOL)) { return tUni }
          else { throw new TypeCheckError("Type mismatch for op" + expr.op);}
      }
    case "id":
      if (locals.vars.has(expr.name)) {
        return {a: locals.vars.get(expr.name), ...expr};
      } else if (env.globals.has(expr.name)) {
        return {a: env.globals.get(expr.name), ...expr};
      } else {
        throw new TypeCheckError("Unbound id: " + expr.name);
      }
    case "builtin1":
      if (expr.name === "print") {
        const tArg = tcExpr(env, locals, expr.arg);
        return {...expr, a: tArg.a, arg: tArg};
      } else if(env.functions.has(expr.name)) {
        const [[expectedArgTyp], retTyp] = env.functions.get(expr.name);
        const tArg = tcExpr(env, locals, expr.arg);
        
        if(isAssignable(env, tArg.a, expectedArgTyp)) {
          return {...expr, a: retTyp, arg: tArg};
        } else {
          throw new TypeError("Function call type mismatch: " + expr.name);
        }
      } else {
        throw new TypeError("Undefined function: " + expr.name);
      }
    case "builtin2":
      if(env.functions.has(expr.name)) {
        const [[leftTyp, rightTyp], retTyp] = env.functions.get(expr.name);
        const tLeftArg = tcExpr(env, locals, expr.left);
        const tRightArg = tcExpr(env, locals, expr.right);
        if(isAssignable(env, leftTyp, tLeftArg.a) && isAssignable(env, rightTyp, tRightArg.a)) {
          return {...expr, a: retTyp, left: tLeftArg, right: tRightArg};
        } else {
          throw new TypeError("Function call type mismatch: " + expr.name);
        }
      } else {
        throw new TypeError("Undefined function: " + expr.name);
      }
    case "call":
      if(env.classes.has(expr.name)) {
        // surprise surprise this is actually a constructor
        const tConstruct : Expr<Type> = { a: CLASS(expr.name), tag: "construct", name: expr.name };
        const [_,field,methods] = env.classes.get(expr.name);
        if (methods.has("__init__")) {
          const [initArgs, initRet] = methods.get("__init__");
          if (expr.arguments.length !== initArgs.length - 1)
            throw new TypeCheckError("__init__ didn't receive the correct number of arguments from the constructor");
          if (initRet !== NONE) 
            throw new TypeCheckError("__init__  must have a void return type");
          return tConstruct;
        } else {
          return tConstruct;
        }
      } else if(env.functions.has(expr.name)) {
        const [argTypes, retType] = env.functions.get(expr.name);
        const tArgs = expr.arguments.map(arg => tcExpr(env, locals, arg));
        // t2 = t1
        // B = A
        if(argTypes.length === expr.arguments.length &&
           tArgs.every((tArg, i) => isAssignable(env, tArg.a, argTypes[i]))) {
             return {...expr, a: retType, arguments: expr.arguments};
           } else {
            throw new TypeError("Function call type mismatch: " + expr.name);
           }
      } else {
        throw new TypeError("Undefined function: " + expr.name);
      }
    case "lookup":
      var tObj = tcExpr(env, locals, expr.obj);
      if (tObj.a.tag === "class") {
        if (env.classes.has(tObj.a.name)) {
          const [_,fields] = env.classes.get(tObj.a.name);
          if (fields.has(expr.field)) {
            return {...expr, a: fields.get(expr.field), obj: tObj};
          } else {
            throw new TypeCheckError(`could not found field ${expr.field} in class ${tObj.a.name}`);
          }
        } else {
          throw new TypeCheckError("field lookup on an unknown class");
        }
      } else {
        throw new TypeCheckError("field lookups require an object");
      }
    case "method-call":
      var tObj = tcExpr(env, locals, expr.obj);
      var tArgs = expr.arguments.map(arg => tcExpr(env, locals, arg));
      if (tObj.a.tag === "class") {
        if (env.classes.has(tObj.a.name)) {
          const [_, __, methods] = env.classes.get(tObj.a.name);
          if (methods.has(expr.method)) {
            const [methodArgs, methodRet] = methods.get(expr.method);
            const realArgs = [tObj].concat(tArgs);
            if(methodArgs.length === realArgs.length &&
              methodArgs.every((argTyp, i) => isAssignable(env, realArgs[i].a, argTyp))) {
                return {...expr, a: methodRet, obj: tObj, arguments: tArgs};
              } else {
               throw new TypeCheckError(`Method call type mismatch: ${expr.method} --- callArgs: ${JSON.stringify(realArgs)}, methodArgs: ${JSON.stringify(methodArgs)}` );
              }
          } else {
            throw new TypeCheckError(`could not found method ${expr.method} in class ${tObj.a.name}`);
          }
        } else {
          throw new TypeCheckError("method call on an unknown class");
        }
      } else {
        throw new TypeCheckError("method calls require an object");
      }
    default: throw new TypeCheckError(`unimplemented type checking for expr: ${expr}`);
  }
}

export function tcLiteral(literal : Literal) {
    switch(literal.tag) {
        case "bool": return BOOL;
        case "num": return NUM;
        case "none": return NONE;
    }
}