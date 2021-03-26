const logTags:any = {
    JSONReader: false
}

export abstract class Serializable {
    abstract getClassSpec(): string;
    abstract marshal(visitor: Visitor<this>): void;

    clone(...initializers: any[]): this { 
        const result:this = new (<any>this.constructor);
        result.overlay(...initializers);
        return result;
    }

    overlay(...initializers: any[]) {
        const initializer = new JSONInitializer(...initializers);
        initializer.init(this);
    }
}

export abstract class Visitor<ExpectedType extends Serializable> {
    abstract beginObject(obj: ExpectedType): void;
    abstract endObject(obj: ExpectedType): void;

    abstract verbatim<DataType>(target: any, propName: string): void;
    abstract primitive<PropType>(target: any, propName: string, fromString?: (initializer:string) => PropType): void;
    abstract scalar<ObjectType extends Serializable>(target: any, propName: string): void;
    abstract array<ElementType extends Serializable>(target: any, propName: string): void;
}

export class Builder<T extends Serializable> {
    classSpec: string;
    allocator: (initializer?: any) => T;

    constructor(classSpec: string, allocator: (initializer?: any) => T) {
        this.classSpec = classSpec;
        this.allocator = allocator;
    }

    make(initializer?: any): T {
        return this.allocator(initializer);
    }

    jsonReader(json: any, factory: Factory) {
        return new JSONReader<T>(json, factory); 
    }

    jsonWriter(obj: T, factory: Factory) {
        return new JSONWriter<T>(obj, factory); 
    }
}

export class Factory {
    specToBuilder: { [key: string]: () => Builder<any> };
    constructor(builders: (() => Builder<any>)[] ) {
        this.specToBuilder = builders.reduce(
            (builders: { [key: string]: () => Builder<any> }, builder: () => Builder<any>) => {
                const tmp = builder();
                builders[tmp.classSpec] = builder;
                return builders;
        }, {});
    }
    
    hasClass(classSpec: any): boolean {
        return classSpec && this.specToBuilder.hasOwnProperty(classSpec.toString());
    }

    instantiate(classSpec: any): Serializable {
        return this.specToBuilder[classSpec.toString()]().make();
    }

    toString(obj: any): string {
        return JSON.stringify(this.toJSON(obj));
    }

    fromString(text: string): any {
        return this.fromJSON(JSON.parse(text));
    }

    toJSON(obj: any, path?: any[]): any {
        const usePath = path || [];
        if(obj instanceof Serializable) {
            //console.log(`toJSON<Serializable> BEGIN ${usePath} = <${typeof obj}>${obj}`);
            const writer = new JSONWriter<any>(obj, this);
            writer.write();
            //console.log(`toJSON<Serializable> END   ${usePath}`);
            return writer.json;
        } else if(Array.isArray(obj)) {
            //console.log(`toJSON<Array> BEGIN ${usePath} = <${typeof obj}>${obj}`);
            const result = obj.map((item: any, index: number) => this.toJSON(item, [ ...usePath, index]));
            //console.log(`toJSON<Array> END   ${usePath}`);
            return result;
        } else if(obj === Object(obj)) {
            //console.log(`toJSON<Object> BEGIN ${usePath}`);
            const result = Object.getOwnPropertyNames(obj).reduce((result: any, propName: string) => {
                result[propName] = this.toJSON(obj[propName], [ ...usePath, propName]);
                return result;
            }, {});
            //console.log(`toJSON<Object> END   ${usePath}`);
            return result;
        } else {
            //console.log(`toJSON<any> BEGIN ${usePath}`);
            //console.log(`toJSON<any> END   ${usePath}`);
            return obj;
        }
    }

    fromJSON(json: any): any {
        if(this.hasClass(json['__class__'])) {
            const builder = this.specToBuilder[json['__class__']]();
            const reader = builder.jsonReader(json, this);
            reader.read();
            return reader.obj;
        } else if(Array.isArray(json)) {
            return json.map((item: any) => this.fromJSON(item));
        } else if(json === Object(json)) {
            return Object.getOwnPropertyNames(json).reduce((result: any, propName: string) => {
                result[propName] = this.fromJSON(json[propName]);
                return result;
            }, {});
        } else {
            return json;
        }
    }
}

export interface Property<PropType> {
    value: PropType|undefined;
    setValue: (value: PropType) => void;
}

export class Primitive<ExpectedType> implements Property<ExpectedType> {
    propName: string;
    value: ExpectedType|undefined;
    setValue: (value: ExpectedType) => void;

    constructor(target: any, propName: string) {
        this.propName = propName;
        this.value = target[propName];
        this.setValue = (value: ExpectedType) => target[propName] = value;
    }
}

export class Scalar<ExpectedType> implements Property<ExpectedType> {
    propName: string;
    value: ExpectedType|undefined;
    setValue: (value: ExpectedType) => void;

    constructor(target: any, propName: string) {
        this.propName = propName;
        this.value = target[propName];
        this.setValue = (value: ExpectedType) => target[propName] = value;
    }
}

export class ArrayProp<ExpectedType> implements Property<ExpectedType[]> {
    propName: string;
    value: ExpectedType[]|undefined;
    setValue: (value: ExpectedType[]) => void;

    constructor(target: any, propName: string) {
        this.propName = propName;
        this.value = target[propName];
        this.setValue = (value: ExpectedType[]) => target[propName] = value;
    }
}

export class JSONInitializer<ExpectedType extends Serializable> implements Visitor<ExpectedType> {
    initializers: any[];
    obj?: ExpectedType;
    beginObject(obj: ExpectedType): void { this.obj = obj; }
    endObject(obj: ExpectedType): void {}

    constructor(...initializers: any[]) {
        this.initializers = initializers;
    }

    verbatim<DataType>(target: any, propName: string): void {
        const property = new Primitive<DataType>(target, propName);
        const newValue = this.initializers.reduce(
            (result: any, initializer: any) => initializer || result
        , undefined);
        if(newValue !== undefined)
            property.setValue(newValue);
    }

    primitive<PropType>(target: any, propName: string, fromString?: (initializer:string) => PropType): void {
        const property = new Primitive<PropType>(target, propName);
        const newValue = this.initializers.reduce(
            (result: any, initializer: any) => initializer[propName] || result
        , undefined);
        if(newValue !== undefined) {
            const typedValue = (typeof(newValue) === 'string')  && fromString ? fromString(newValue) : newValue;
            property.setValue(typedValue);
        }
    }

    scalar<ObjectType extends Serializable>(target: any, propName: string): void {
        const property = new Scalar<ObjectType>(target, propName);
        const newValues = this.initializers.filter(
            (initializer: any) => initializer[propName] !== undefined
        ).map((initializer: any) => initializer[propName]);
        if(newValues.length == 1) {
            return property.setValue(newValues[0]);
        } else if(newValues.length > 1) {
            return property.setValue(newValues[0].clone(... newValues));
        }
    }

    array<ElementType extends Serializable>(target: any, propName: string): void {
        const property = new ArrayProp<ElementType>(target, propName);
        const hasProperty = this.initializers.filter(
            (initializer: any) => initializer[propName] !== undefined
        );
        const maxLength = hasProperty.reduce(
            (result: number, initializer: any) => 
                Math.max(initializer[propName].length, result)
        , 0);
        if(maxLength > 0) {
            const newArrayValue = [ ... Array(maxLength).keys() ].reduce(
                (arrayValue: ElementType[], index: number) => {
                    const longEnoughArrays = hasProperty.filter(
                        (initializer: any) => index < initializer[propName].length
                    );
                    const elementValues = longEnoughArrays.reduce(
                        (collected: ElementType[], initializer: any) => 
                        [ ... collected, initializer[propName][index]]
                    , []);
                    const elementValue: ElementType = elementValues.length > 0 && 
                        elementValues[0].clone(... elementValues);
                    return [ ... arrayValue, elementValue ];
                }
            , []);
            property.setValue(newArrayValue);
        }
    }

    init(target: ExpectedType): any {
        target.marshal(this);
    }
}

export class JSONReader<ExpectedType extends Serializable> implements Visitor<ExpectedType> {
    json: any;
    obj: ExpectedType|undefined;
    factory: Factory;
    refs: { [key:string]: { [key:string]: any } };
    is_ref: boolean;

    // Reads in-memory representation from semi-self-describing JSON by introspecting objects using their marshal method
    constructor(json: any, factory: Factory, refs?: { [key:string]: { [key:string]: any } }) {
        this.json = json;
        this.factory = factory;
        this.refs = refs ? refs : {};
        this.is_ref = false;
    }

    jsonPreview(): string {
        return(JSON.stringify(this.json).substr(0,80));
    }

    beginObject(obj: ExpectedType) {
        // Must be called at the start of any marshal method. Tells this object that we are visiting the body of that object next
        if(!this.obj) {
            this.obj = obj;
        }
        if(!this.json.hasOwnProperty('__class__')) {
            throw new Error(`Expected __class__ to be present in JSON. Properties included ${Object.keys(this.json)}`);
        }
        const class_name = this.json['__class__'];
        if(!this.refs.hasOwnProperty(class_name)) {
            this.refs[class_name] = {};
        }
        const by_id = this.refs[class_name];
        if(this.json.hasOwnProperty('__id__')) {
            if(by_id.hasOwnProperty(this.json['__id__'])) {
                this.obj = <ExpectedType>by_id[this.json['__id__']];
                this.is_ref = true;
            } else {
                by_id[this.json['__id__']] = this.obj;
            }
        }
    }

    endObject(obj:ExpectedType) {
        //Must be called at the end of any marshal method. Tells this object that we are done visiting the body of that object
    }

    verbatim<DataType>(target: any, propName: string): void {
        // For the in-memory object currently being read from JSON, read the value of attribute :attr_name from JSON propery attr_name.
        // Expect that the attribute value is probably not a reference to a shared object (though it may be)

        const property = new Primitive<DataType>(target, propName);
        if(!this.json) {
            throw new Error('No JSON here');
        } else {
            property.setValue(this.json);
        }
    }    

    primitive<PropType>(target: any, propName: string, fromString?: (initializer:string) => PropType): void {
        // For the in-memory object currently being read from JSON, read the value of attribute :attr_name from JSON propery attr_name.
        // Expect that the attribute value is probably not a reference to a shared object (though it may be)

        const property = new Primitive<PropType>(target, propName);
        if(!this.json) {
            throw new Error('No JSON here');
        } else if(this.json.hasOwnProperty(property.propName)) {
            const newValue = (typeof(this.json[propName]) === 'string')  && fromString ? fromString(this.json[propName]) : this.json[propName];
            property.setValue(newValue);
        }
    }    

    scalar<ObjectType extends Serializable>(target: any, propName: string): void {
        // For the in-memory object currently being read from JSON, read the value of attribute :attr_name from JSON propery attr_name.
        // Expect that the attribute value is probably not a reference to a shared object (though it may be)
        const property = new Scalar<ObjectType>(target, propName);
        if(!this.json) {
            throw new Error('No JSON here');
        } else if(this.json.hasOwnProperty(property.propName)) {            
            const reader = new JSONReader<ObjectType>(this.json[property.propName], this.factory, this.refs);
            reader.read();
            if(reader.obj) {
                property.setValue(reader.obj);
            }
        } else if (!this.is_ref) {
            if(logTags.JSONReader)
                console.log(`WARNING: While reading object of type ${this.obj?.getClassSpec()} property ${property.propName} is missing in JSON ${this.jsonPreview()}`);
        }
    }

    array<ElementType extends Serializable>(target: any, propName: string): void {
        // For the in-memory object currently being read from JSON, read the value of attribute :attr_name from JSON propery attr_name
        // Expect that the attribute value is probably a reference to a shared object (though it may not be)

        const property = new ArrayProp<ElementType>(target, propName);
        if(!this.json) {
            throw new Error('No JSON here');
        } else if(this.json.hasOwnProperty(property.propName)) {     
            const propValue = this.json[property.propName];            
            property.setValue(propValue.map((item: any) => {
                const reader = new JSONReader<ElementType>(item, this.factory, this.refs);
                reader.read();
                return(reader.obj);
            }).filter((item: ElementType|undefined): item is ElementType => !!item));
        } else if (!this.is_ref) {
            if(logTags.JSONReader)
                console.log(`WARNING: While reading object of type ${this.obj?.getClassSpec()} property ${property.propName} is missing in JSON ${this.jsonPreview()}`);
        }
    }

    read(): any {
        const klass = this.json['__class__']
        if(this.factory.hasClass(klass)) {
            const newObject = <ExpectedType>this.factory.instantiate(klass);
            newObject.marshal(this);
            this.obj = <ExpectedType>newObject;
            return newObject;
        } else {
            throw new Error(`Cannot construct object by reading JSON: ${this.jsonPreview()}`);
        }
    }
}

export class JSONWriter<ExpectedType extends Serializable> implements Visitor<ExpectedType> {
    obj:ExpectedType;
    json: any;
    factory: Factory;
    refs: { [key:string]: any[] };
    is_ref?: boolean;

    // Reads in-memory representation from semi-self-describing JSON by introspecting objects using their marshal method
    constructor(obj: ExpectedType, factory: Factory, refs?: { [key:string]: object[] }) {
        this.obj = obj;
        this.factory = factory;
        this.refs = refs ? refs : {};
    }

    beginObject(obj: ExpectedType) {
        // Must be called at the start of any marshal method. Tells this object that we are visiting the body of that object next"""
        this.json = {};
        
        const class_name = obj.getClassSpec();
        if(!this.refs.hasOwnProperty(class_name)) {
            this.refs[class_name] = [];
        }
        this.json['__class__'] = class_name;
        if(!class_name) {
            throw new Error(`Cannot find class name for ${typeof obj} with builders ${Object.getOwnPropertyNames(this.factory.specToBuilder)}`);
        }
        if(this.is_ref === undefined) {
            const ref_index = this.refs[class_name].indexOf(obj);
            if(ref_index >= 0) {
                this.is_ref = true;
            } else {
                this.is_ref = false;
                this.refs[class_name] = [ ... this.refs[class_name], obj ];
            }        
        }
        const ident = this.refs[class_name].indexOf(obj).toString();
        this.json['__id__'] = ident;
        this.json['__is_ref__'] = this.is_ref;
    }

    endObject(obj: ExpectedType) {
        // Must be called at the end of any marshal method. Tells this object that we are done visiting the body of that object
        const class_name = obj.getClassSpec();
        const ident = this.json['__id__'];
    }

    verbatim<DataType>(target: any, propName: string): void {
        const property = new Primitive<DataType>(target, propName);
        if(property.value && !this.is_ref) {
            this.json = property.value;
        }
    }

    primitive<PropType>(target: any, propName: string, fromString?: (initializer:string) => PropType): void {
        const property = new Primitive<PropType>(target, propName);
        if(property.value && !this.is_ref) {
            this.json[property.propName] = property.value;
        }
    }

    scalar<ObjectType extends Serializable>(target: any, propName: string): void {
        // For the in-memory object currently being read from JSON, read the value of attribute :attr_name from JSON propery attr_name.
        // Expect that the attribute value is probably not a reference to a shared object (though it may be)
        const property = new Scalar<ObjectType>(target, propName);
        // For the in-memory object currently being written to JSON, write the value of attribute :attr_name to JSON propery attr_name.
        // Expect that the attribute value is probably not a reference to a shared object (though it may be)

        if(property.value && !this.is_ref) {
            const writer = new JSONWriter<ObjectType>(property.value, this.factory, this.refs);
            writer.write();
            this.json[property.propName] = writer.json;
        }
    }

    array<ElementType extends Serializable>(target: any, propName: string): void {
        // For the in-memory object currently being written to JSON, write the value of attribute :attr_name to JSON propery attr_name
        // Expect that the attribute value is probably a reference to a shared object (though it may not be)

        const property = new ArrayProp<ElementType>(target, propName);
        if(property.value && !this.is_ref) {
            this.json[property.propName] = property.value.map((item: ElementType) => {
                const writer = new JSONWriter<ElementType>(item, this.factory, this.refs);
                writer.write();
                return writer.json;
            }).filter((json:any) => !!json);
        }
    }

    write(): any {
        if(!!this.json) {
            // pass
        } else if(this.obj instanceof Serializable) {
            this.obj.marshal(this);
        } else {
            this.json = this.obj;
        }
        return this.json;
    }
}
