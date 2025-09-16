import { Component, OnInit } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../environments/environment';

@Component({
  selector: 'world-map',
  templateUrl: './world-map.component.html',
  styleUrls: ['./world-map.component.css']
})
export class WorldMapComponent implements OnInit {

  public activeTab: string = 'overground';
  public viewMode: string = 'map'; // 'map' or 'scripts'
  public activeFunctionType: string = 'system'; // 'system', 'model', 'mesh'
  public selectedFunction: any = null;
  public tabs = [
    { id: 'overground', label: 'Overground' },
    { id: 'underwater', label: 'Underwater' },
    { id: 'glacier', label: 'Glacier' }
  ];

  public scriptData: any = {};
  public loadingScripts: boolean = false;
  public scriptError: string = '';
  public expandedSections: { [key: string]: boolean } = {};
  public cachedSections: { [key: string]: any[] } = {};

  constructor(private http: HttpClient) { }

  ngOnInit() {
    this.loadAllScripts();
  }

  onSelectTab(tabId: string) {
    this.activeTab = tabId;
    // Clear cached sections when switching tabs
    this.cachedSections = {};
  }

  onToggleView(mode: string) {
    this.viewMode = mode;
    if (mode === 'scripts') {
      // Reset script view state when switching to scripts
      this.selectedFunction = null;
    }
  }

  onSelectFunctionType(type: string) {
    this.activeFunctionType = type;
    this.selectedFunction = null; // Clear selection when switching types
  }

  onSelectFunction(func: any) {
    this.selectedFunction = func;
  }

  getFunctionsByType(type: string): any[] {
    const scriptData = this.getScriptDataForActiveTab();
    if (!scriptData || !scriptData.functions) {
      return [];
    }

    const functions = this.parseFunctions(scriptData.functions);
    
    // Filter functions based on type (you may need to adjust this logic based on your data structure)
    return functions.filter(func => {
      const name = func.name.toLowerCase();
      switch (type) {
        case 'system':
          return name.includes('system') || name.includes('init') || name.includes('main') || func.index < 10;
        case 'model':
          return name.includes('model') || name.includes('entity') || name.includes('object') || (func.index >= 10 && func.index < 50);
        case 'mesh':
          return name.includes('mesh') || name.includes('render') || name.includes('draw') || func.index >= 50;
        default:
          return false;
      }
    });
  }

  getFunctionTypeCount(type: string): number {
    return this.getFunctionsByType(type).length;
  }

  private loadAllScripts() {
    this.loadingScripts = true;
    this.scriptError = '';

    const scriptFiles = [
      { key: 'overground', file: 'wm0.json' },
      { key: 'underwater', file: 'wm2.json' },
      { key: 'glacier', file: 'wm3.json' }
    ];

    const requests = scriptFiles.map(script => 
      this.http.get(`${environment.KUJATA_DATA_BASE_URL}/data/world/scripts/${script.file}`)
        .toPromise()
        .then(data => ({ key: script.key, data, error: null }))
        .catch(error => ({ key: script.key, data: null, error }))
    );

    Promise.all(requests).then(results => {
      console.log('Script loading results:', results);
      
      results.forEach(result => {
        if (result.error) {
          console.error(`Error loading ${result.key} scripts:`, result.error);
          this.scriptError += `Failed to load ${result.key} scripts. `;
        } else {
          console.log(`Successfully loaded ${result.key} scripts:`, result.data);
          this.scriptData[result.key] = result.data;
        }
      });
      
      console.log('Final scriptData object:', this.scriptData);
      this.loadingScripts = false;
    });
  }

  public getScriptDataForActiveTab() {
    return this.scriptData[this.activeTab] || null;
  }

  public getScriptKeys(scriptData: any): string[] {
    return scriptData ? Object.keys(scriptData) : [];
  }

  public getScriptSections(scriptData: any) {
    if (!scriptData) return [];
    
    // Cache sections to avoid recalculating on every change detection
    const cacheKey = this.activeTab;
    if (this.cachedSections[cacheKey]) {
      return this.cachedSections[cacheKey];
    }
    
    const sections = Object.keys(scriptData).map(key => ({
      name: key,
      data: scriptData[key],
      expanded: false // Initialize expanded state
    }));
    
    this.cachedSections[cacheKey] = sections;
    return sections;
  }

  public parseScriptCommands(scriptSection: any): any[] {
    if (!scriptSection || !Array.isArray(scriptSection)) {
      return [];
    }

    return scriptSection.map((command, index) => ({
      index: index,
      opcode: command.opcode || 'Unknown',
      operation: command.operation || command.op || 'Unknown Operation',
      parameters: this.formatParameters(command),
      rawCommand: command
    }));
  }

  public parseFunctions(functionsArray: any): any[] {
    if (!functionsArray || !Array.isArray(functionsArray)) {
      return [];
    }

    return functionsArray.map((func, index) => ({
      index: index,
      name: func.description || func.name || `Function ${index}`,
      offset: func.offset || 0,
      length: func.length || 0,
      numOpcodes: func.numOpcodes || 0,
      opcodes: func.opcodes || [],
      hasOpcodes: func.opcodes && func.opcodes.length > 0
    }));
  }

  public formatOpcode(opcode: any, index: number): any {
    return {
      index: index,
      js: opcode.js || 'No JS representation',
      raw: opcode.raw || 'No raw data',
      hasJs: !!opcode.js,
      hasRaw: !!opcode.raw
    };
  }

  private formatParameters(command: any): string {
    const excludeKeys = ['opcode', 'operation', 'op'];
    const params = Object.keys(command)
      .filter(key => !excludeKeys.includes(key))
      .map(key => `${key}: ${this.formatValue(command[key])}`)
      .join(', ');
    
    return params || 'No parameters';
  }

  private formatValue(value: any): string {
    if (typeof value === 'object' && value !== null) {
      return JSON.stringify(value);
    }
    return String(value);
  }

  public getScriptTypeName(scriptName: string): string {
    const typeMap: { [key: string]: string } = {
      'init': 'Initialization Script',
      'main': 'Main Script',
      'entity': 'Entity Scripts',
      'entities': 'Entity Scripts',
      'script': 'General Scripts',
      'scripts': 'General Scripts'
    };
    
    return typeMap[scriptName.toLowerCase()] || scriptName;
  }

  public isArray(data: any): boolean {
    return Array.isArray(data);
  }

  public isObject(data: any): boolean {
    return !Array.isArray(data) && typeof data === 'object' && data !== null;
  }

  public isPrimitive(data: any): boolean {
    return !Array.isArray(data) && typeof data !== 'object';
  }

  public getObjectKeys(obj: any): string[] {
    return Object.keys(obj || {});
  }

  public toggleSection(sectionName: string) {
    const key = `${this.activeTab}_${sectionName}`;
    console.log('toggleSection called - Section:', sectionName, 'Key:', key, 'Before:', this.expandedSections[key]);
    
    this.expandedSections[key] = !this.expandedSections[key];
    
    console.log('After toggle:', this.expandedSections[key]);
  }

  public isSectionExpanded(sectionName: string): boolean {
    const key = `${this.activeTab}_${sectionName}`;
    return !!this.expandedSections[key];
  }
}
