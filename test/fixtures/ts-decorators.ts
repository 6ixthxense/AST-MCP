@Component({ selector: "app" })
export class AppComponent {
  @Get("/items/:id")
  async getItem(id: string) {
    return this.fetch(id);
  }

  fetch(id: string) {
    return id;
  }
}
