import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";


export enum ArticleCategory {
  SELLING_TIPS= "SELLING_TIPS",
  BUYING_GUIDE = "BUYING_GUIDE",
  MARKET_ANALYSIS="MARKET_ANALYSI",
    
    
}

@Schema({timestamps:true})
export class Article {
  @Prop({required:true})
  image:string

  @Prop({required:true})
  title:string

  @Prop({required:false})
  publishDate:string

  @Prop({required:true})
  blogDetails: string

  @Prop({required:true})
  category:ArticleCategory  
   
}


export const ArticleSchema = SchemaFactory.createForClass(Article)