using System.Net.Http;
using LegendsAndMaps.Components;
using LegendsAndMaps.Services;
using Microsoft.AspNetCore.Components.Web;
using Microsoft.AspNetCore.Components.WebAssembly.Hosting;

var builder = WebAssemblyHostBuilder.CreateDefault(args);

builder.RootComponents.Add<App>("#app");
builder.RootComponents.Add<HeadOutlet>("head::after");

builder.Services.AddScoped(sp => new HttpClient { BaseAddress = new Uri(builder.HostEnvironment.BaseAddress) });

// Preload the SVG once so the app can provide country counts and default-group behavior.
var http = new HttpClient { BaseAddress = new Uri(builder.HostEnvironment.BaseAddress) };
var svgText = await http.GetStringAsync("data/world.svg");
var countryCatalog = CountryCatalog.LoadFromSvgContent(svgText);

builder.Services.AddSingleton(countryCatalog);
builder.Services.AddScoped<IMapStateService, InMemoryMapStateService>();

await builder.Build().RunAsync();
