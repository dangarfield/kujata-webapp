import { Component, OnInit } from '@angular/core';

@Component({
  selector: 'world-map',
  templateUrl: './world-map.component.html',
  styleUrls: ['./world-map.component.css']
})
export class WorldMapComponent implements OnInit {

  public activeTab: string = 'overground';
  public tabs = [
    { id: 'overground', label: 'Overground' },
    { id: 'underwater', label: 'Underwater' },
    { id: 'glacier', label: 'Glacier' }
  ];

  constructor() { }

  ngOnInit() {
  }

  onSelectTab(tabId: string) {
    this.activeTab = tabId;
  }
}
