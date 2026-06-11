import { Component, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import * as sdk from '@patheya/api-sdk';

console.log(sdk);

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  protected readonly title = signal('customer-app');
}
