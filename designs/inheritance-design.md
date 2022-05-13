### Test Cases

# No.1: field access
```
class A(object):
    a : int = 1
class B(A):
    pass
x : B = None
x = B()
print(x.a)
```
Expected Output -> 1

# No.2: method call
```
class A(object):
    a : int = 1
    def get(self: A)->int:
        return self.a
class B(A):
    pass
x : B = None
x = B()
print(x.get())
```
Expected Output -> 1

# No.3: wrong super class type (TC)
```
class Test(None):
    x : int = 0
```
Expected Output -> TYPE ERROR (Cannot extend None)

# No.4: parent-child same field (TC)
```
class A(object):
    a : int = 1
class B(A):
    a: int = 0
```

Expected Output -> TYPE ERROR: Parent-child cannot have same field

# No.5: method overwrite
```
class Person(object):
    age:int = 0
    # Constructor
    def __init__(self:Person,age:int):
        self.age = age
  
    # To get age
    def getAge(self:Person)->int:
        return self.age
  
    # To check if this person is employee
    def isEmployee(self:Person)->bool:
        return False
  
  
# Inherited or Sub class (Note Person in bracket)
class Employee(Person):

    def __init__(self:Employee,age:int):
        self.age = age

    # Here we return true
    def isEmployee(self:Employee)->bool:
        return True
  
# Driver code
emp1:Person = None
emp1 = Person(40)  # An Object of Person
print(emp1.getAge())
print(emp1.isEmployee())



emp = Employee(30) # An Object of Employee
print(emp.getAge())
print(emp.isEmployee())
```

Expected output:
```
40
False
30
True
```


# No.6: method overwrite with different signature (TC)
```
class A(object):
    def test(self: A, arg: int):
        pass
class B(A):
    def test(self: B, arg: bool):
        pass
```
Expected output -> TYPE ERROR: Method overriden with different signature

# No.7: method overwrite with different return type (TC)
```
class A(object):
    def test(self: A)->int:
        return 1
class B(A):
    def test(self: B)->bool:
        return False
```

Expected output -> TYPE ERROR: Method overriden with different return

# No.8: type conversion from subclass to superclass
```
class A(object):
    x : int = 1
class B(A):
    x: int = 0
def test(arg: A):
    print(arg.x)
x : B = None
x = B()
test(x)
```
Expected output -> 1 



# No.9: type conversion from superclass to subclass (TC)
```
class A(object):
    a : int = 1
class B(A):
    a: int = 0
def test(arg: B):
    pass
x : A = None
x = A()
test(x)
```

Expected output -> TYPE ERROR: Assigning super class to subclass

# No.10 Chained calls
```
class CL(object):
    def sum(self : CL) -> int:
        return 1//0
    def count(self : CL) -> int:
        return 1//0

class Empty(CL):
    def sum(self : Empty) -> int:
        return 0
    def count(self: Empty) -> int:
        return 0

class Single(CL):
    val : int = 0
    def new(self : Single, val : int) -> Single:
        self.val = val
        return self
    def count(self: Single) -> int:
        return 1
    def sum(self : Single) -> int:
        return self.val
    def getval(self: Single) -> int:
        return self.val

class Concat(CL):
    left : CL = None
    right : CL = None
    def sum(self : Concat) -> int:
        return self.left.sum() + self.right.sum()
    def count(self : Concat) -> int:
        return self.left.count() + self.right.count()
    def new(self : Concat, l : CL, r : CL) -> Concat:
        self.left = l
        self.right = r
        return self

l : CL = None
l = Concat().new(Single().new(5), Empty())
print(l.count())
print(Single().getval())
```
Expected output ->
```
1
0
```

######

## Design changes

## AST.ts
```
Added supers in class like below to store the super classes for each class. It's an array because we will support
multiple inheritance in future

export type Class<A> = { a?: A, name: string, supers: Array<string>, fields: Array<VarInit<A>>, methods: Array<FunDef<A>>}

```

## IR.ts
```
Added supers in class like below to store the super classes for each class. It's an array because we will support
multiple inheritance in future

export type Class<A> = { a?: A, name: string, supers: Array<string>, fields: Array<VarInit<A>>, methods: Array<FunDef<A>>}

```

## type-check.ts
```
1) Currently we have a map from className -> [{FieldNames,Type},{FuncName,{[ParameterTypes],RetType}}]

    We need to add super class info in the GlobalEnv, as below.

    className -> [{FieldNames,Type},{FuncName,{[ParameterTypes],RetType}},[SuperClassType]]

    classes: Map<string, [Map<string, Type>, Map<string, [Array<Type>, Type]>,Array<Type>]>

2) New function isSubClass(t1:Type,t2:Type)
    This will check if t1 is a subclass of t2

   Modify isSubtype to below:
    export function isSubtype(env: GlobalTypeEnv, t1: Type, t2: Type): boolean {
        return equalType(t1, t2) || isSubClass(t1,t2) ||t1.tag === "none" && t2.tag === "class" 
    }
```

## compiler.ts
For Week 7, we do not plan to support multiple inheritance yet. Thus, our approach for implementing inherited method calls follows from Lectures 9 and 10.
We will add a vtable and use ```call_indirect``` to reference the correct method calls.
The compiler will need to build a ```funcref``` table and populate it with all the class-prefixed methods.
Furthermore, each object struct will need to be augmented with a field that stores its class's offset into the table.
In the case that a subclass does not override a method of its superclass, we will probably populate the table with a dummy entry that allows the subclass to reference the superclass's method.

e.g. given the following classes
```
class A(object):
    def foo(self : A, arg : int):
        print(arg)

class B(A):
    def foo2(self : B, arg : bool):
        print(arg)
    # B does not override foo()
```

We think the resulting table should look something like
```
(table 3 funcref) <-- 3 because there's 3 function references (not 2)
(elem (i32.const 0) 
    A$foo
    A$foo
    B$foo2
)
```
We would put ```A$foo``` in twice and note A's offset as 0 while B's offset is 1.
This way, if something like ```B().foo(0)``` is called, then the WASM will know to reference the ```A$foo``` at offset 1.

## new test:
```
class A(object):
    a : int = 1
class B(A):
    b : int = 1
class C(B):
    c : bool = False
x : C = None
x = C()
print(x.a)
print(x.b)
print(x.c)
```
We expect that C inherits 2 fields for a total of 3.